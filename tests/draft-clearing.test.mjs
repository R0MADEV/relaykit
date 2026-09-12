import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

class CountingStorage extends InMemoryStorage {
  draftWrites = 0;

  async saveDraft(conversationId, text) {
    this.draftWrites += 1;
    return super.saveDraft(conversationId, text);
  }
}

async function startClient() {
  const adapter = new InMemoryAdapter();
  const storage = new CountingStorage();
  const client = new MessagingClient({ adapter, storage, session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  return { adapter, client, storage, conversation };
}

test("sending one after another does not clear a draft that is not there over and over", async () => {
  const { client, storage, conversation } = await startClient();
  await client.messages.send(conversation.id, "uno");
  storage.draftWrites = 0;

  for (let index = 0; index < 10; index += 1) {
    await client.messages.send(conversation.id, `mensaje ${index}`);
  }

  assert.equal(storage.draftWrites, 0, `it cleared the draft ${storage.draftWrites} times for nothing`);
  await client.stop();
});

test("a draft that is there is still cleared when the message goes out", async () => {
  const { client, conversation } = await startClient();
  await client.messages.send(conversation.id, "uno");
  await client.conversations.saveDraft(conversation.id, "esto lo estaba escribiendo");

  await client.messages.send(conversation.id, "dos");

  assert.equal(await client.conversations.draft(conversation.id), undefined);
  await client.stop();
});

test("a draft left from another session is cleared on the first send", async () => {
  const adapter = new InMemoryAdapter();
  const storage = new CountingStorage();
  const first = new MessagingClient({ adapter, storage, session });
  await first.start();
  const conversation = await first.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  await first.conversations.saveDraft(conversation.id, "de la sesion anterior");
  await first.stop();

  const second = new MessagingClient({ adapter: new InMemoryAdapter(), storage, session });
  await second.start();
  await second.messages.send(conversation.id, "ya lo envio");

  assert.equal(await second.conversations.draft(conversation.id), undefined);
  await second.stop();
});

test("a draft written while the client was stopped is cleared on the next send", async () => {
  const { client, storage, conversation } = await startClient();
  await client.messages.send(conversation.id, "uno");

  await client.stop();
  // Written by somebody else while this client was not running, which is what another tab or device does.
  await storage.saveDraft(conversation.id, "escrito mientras no miraba");
  await client.start();
  await client.messages.send(conversation.id, "dos");

  assert.equal(await storage.getDraft(conversation.id), undefined);
  await client.stop();
});

test("each conversation clears its own draft", async () => {
  const { client, conversation } = await startClient();
  const other = await client.conversations.create({ participantIds: ["carol"], title: "Otra" });
  await client.conversations.saveDraft(conversation.id, "aqui");
  await client.conversations.saveDraft(other.id, "alli");

  await client.messages.send(conversation.id, "enviado aqui");

  assert.equal(await client.conversations.draft(conversation.id), undefined);
  assert.equal(await client.conversations.draft(other.id), "alli");
  await client.stop();
});
