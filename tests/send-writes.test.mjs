import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

class RecordingStorage extends InMemoryStorage {
  savedStatuses = [];

  async saveMessage(message) {
    this.savedStatuses.push(message.status);
    return super.saveMessage(message);
  }

  async saveMessages(messages) {
    for (const message of messages) this.savedStatuses.push(message.status);
    return super.saveMessages(messages);
  }
}

async function startClient() {
  const adapter = new InMemoryAdapter();
  const storage = new RecordingStorage();
  const client = new MessagingClient({ adapter, storage, session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  storage.savedStatuses.length = 0;
  return { adapter, client, storage, conversation };
}

test("sending a message does not write a state that only exists while it is in flight", async () => {
  const { client, storage, conversation } = await startClient();

  await client.messages.send(conversation.id, "hola");

  assert.ok(
    !storage.savedStatuses.includes("sending"),
    `it kept these states: ${storage.savedStatuses.join(", ")}`
  );
  await client.stop();
});

test("what is kept is what it was and what it became", async () => {
  const { client, storage, conversation } = await startClient();

  await client.messages.send(conversation.id, "hola");

  assert.deepEqual(storage.savedStatuses, ["queued", "sent"]);
  await client.stop();
});

test("in flight is still announced, because that is what the screen shows", async () => {
  const { client, conversation } = await startClient();
  const seen = [];
  client.on("message.updated", message => seen.push(message.status));

  await client.messages.send(conversation.id, "hola");

  assert.ok(seen.includes("sending"), `it announced: ${seen.join(", ")}`);
  await client.stop();
});

test("a send cut off halfway leaves the message waiting, not stuck in flight", async () => {
  const { adapter, client, storage, conversation } = await startClient();
  adapter.sendMessage = () => Promise.reject(new Error("the homeserver went away"));

  await client.messages.send(conversation.id, "a medias").catch(() => undefined);

  const kept = (await storage.getMessages(conversation.id)).find(message => message.body === "a medias");
  assert.ok(kept?.status === "queued" || kept?.status === "failed", `it was left as ${kept?.status}`);
  await client.stop();
});
