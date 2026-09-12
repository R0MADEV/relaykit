import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

class FlakyAdapter extends InMemoryAdapter {
  reachable = true;
  reads = [];

  async markMessageRead(conversationId, messageId) {
    if (!this.reachable) throw new Error("the homeserver is not answering");
    this.reads.push(messageId);
    return super.markMessageRead(conversationId, messageId);
  }
}

async function startClient() {
  const adapter = new FlakyAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  return { adapter, client, conversation };
}

test("opening a conversation with no homeserver does not throw it in the reader's face", async () => {
  const { adapter, client, conversation } = await startClient();
  const arrived = adapter.receiveMessage(conversation.id, "bob", "hola");
  adapter.reachable = false;

  await client.messages.markRead(conversation.id, arrived.id);

  assert.deepEqual(adapter.reads, []);
  await client.stop();
});

test("what was read with no homeserver is told once there is one", async () => {
  const { adapter, client, conversation } = await startClient();
  const arrived = adapter.receiveMessage(conversation.id, "bob", "hola");
  adapter.reachable = false;
  await client.messages.markRead(conversation.id, arrived.id);

  adapter.reachable = true;
  adapter.simulateConnection("connected");
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.deepEqual(adapter.reads, [arrived.id]);
  await client.stop();
});

test("only the furthest point read is told, not every step", async () => {
  const { adapter, client, conversation } = await startClient();
  const first = adapter.receiveMessage(conversation.id, "bob", "uno");
  const second = adapter.receiveMessage(conversation.id, "bob", "dos");
  adapter.reachable = false;
  await client.messages.markRead(conversation.id, first.id);
  await client.messages.markRead(conversation.id, second.id);

  adapter.reachable = true;
  adapter.simulateConnection("connected");
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.deepEqual(adapter.reads, [second.id]);
  await client.stop();
});

test("with a homeserver there, it is told at once as before", async () => {
  const { adapter, client, conversation } = await startClient();
  const arrived = adapter.receiveMessage(conversation.id, "bob", "hola");

  await client.messages.markRead(conversation.id, arrived.id);

  assert.deepEqual(adapter.reads, [arrived.id]);
  await client.stop();
});
