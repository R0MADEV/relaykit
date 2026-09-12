import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  return { adapter, client, conversation };
}

test("a message can be reported to whoever runs the server", async () => {
  const { adapter, client, conversation } = await startClient();
  const offensive = adapter.receiveMessage(conversation.id, "bob", "algo desagradable");

  await client.messages.report(offensive.id, "acoso");

  assert.deepEqual(adapter.reports(), [
    { conversationId: conversation.id, messageId: offensive.id, reason: "acoso" }
  ]);
  await client.stop();
});

test("a report without a reason is refused, because nobody could act on it", async () => {
  const { adapter, client, conversation } = await startClient();
  const offensive = adapter.receiveMessage(conversation.id, "bob", "algo desagradable");

  await assert.rejects(client.messages.report(offensive.id, "   "), /reason/i);

  assert.deepEqual(adapter.reports(), []);
  await client.stop();
});

test("a message that is not here cannot be reported", async () => {
  const { client } = await startClient();

  await assert.rejects(client.messages.report("no-existe", "acoso"), /does not exist/i);
  await client.stop();
});
