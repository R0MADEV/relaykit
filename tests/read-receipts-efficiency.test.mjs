import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

class CountingAdapter extends InMemoryAdapter {
  reads = 0;

  async markMessageRead(conversationId, messageId) {
    this.reads += 1;
    return super.markMessageRead(conversationId, messageId);
  }
}

async function startClient() {
  const adapter = new CountingAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  return { adapter, client, conversation };
}

test("opening a conversation again does not tell the others the same thing twice", async () => {
  const { adapter, client, conversation } = await startClient();
  const arrived = adapter.receiveMessage(conversation.id, "bob", "hola");

  await client.messages.markRead(conversation.id, arrived.id);
  await client.messages.markRead(conversation.id, arrived.id);
  await client.messages.markRead(conversation.id, arrived.id);

  assert.equal(adapter.reads, 1);
  await client.stop();
});

test("reading further along is told", async () => {
  const { adapter, client, conversation } = await startClient();
  const first = adapter.receiveMessage(conversation.id, "bob", "uno");
  const second = adapter.receiveMessage(conversation.id, "bob", "dos");
  await client.messages.markRead(conversation.id, first.id);

  await client.messages.markRead(conversation.id, second.id);

  assert.equal(adapter.reads, 2);
  await client.stop();
});

test("the first time is always told, even if nothing was read before", async () => {
  const { adapter, client, conversation } = await startClient();
  const arrived = adapter.receiveMessage(conversation.id, "bob", "hola");

  await client.messages.markRead(conversation.id, arrived.id);

  assert.equal(adapter.reads, 1);
  await client.stop();
});

test("each conversation is counted on its own", async () => {
  const { adapter, client, conversation } = await startClient();
  const other = await client.conversations.create({ participantIds: ["carol"], title: "Otra" });
  const here = adapter.receiveMessage(conversation.id, "bob", "aqui");
  const there = adapter.receiveMessage(other.id, "carol", "alli");

  await client.messages.markRead(conversation.id, here.id);
  await client.messages.markRead(other.id, there.id);

  assert.equal(adapter.reads, 2);
  await client.stop();
});
