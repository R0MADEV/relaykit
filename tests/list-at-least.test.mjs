import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/** An adapter that only hands over the newest few, the way a thin initial sync does. */
class ThinAdapter extends InMemoryAdapter {
  showAtMost = 1;
  pages = 0;

  async listMessages(conversationId) {
    const everything = await super.listMessages(conversationId);
    return everything.slice(-this.showAtMost);
  }

  async loadMoreMessages(conversationId, limit) {
    this.pages += 1;
    const everything = await super.listMessages(conversationId);
    const messages = everything.slice(-Math.min(limit + this.showAtMost, everything.length));
    return { messages, hasMore: messages.length < everything.length };
  }
}

/**
 * A conversation with history, opened by somebody who has nothing kept locally: that is what a thin initial
 * sync looks like, and what asking for more has to solve.
 */
async function startClient() {
  const adapter = new ThinAdapter();
  const filling = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await filling.start();
  const conversation = await filling.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  for (let index = 0; index < 40; index += 1) {
    adapter.receiveMessage(conversation.id, "bob", `mensaje ${index}`, { createdAt: 1000 + index });
  }
  await filling.stop();

  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client, conversation };
}

test("asking for a conversation gives what the sync brought, as before", async () => {
  const { client, conversation } = await startClient();

  const shown = await client.messages.list(conversation.id);

  assert.equal(shown.length, 1);
  await client.stop();
});

test("asking for enough to read brings older ones in", async () => {
  const { client, conversation } = await startClient();

  const shown = await client.messages.list(conversation.id, { atLeast: 20 });

  assert.ok(shown.length >= 20, `it showed ${shown.length}`);
  await client.stop();
});

test("a conversation with nothing older is asked once and left alone", async () => {
  const { adapter, client, conversation } = await startClient();
  adapter.showAtMost = 40;

  const shown = await client.messages.list(conversation.id, { atLeast: 100 });

  // Asking once is the only way to learn there is no more; asking again would be a loop.
  assert.equal(adapter.pages, 1);
  assert.equal(shown.length, 40);
  await client.stop();
});

test("asking again does not go back for what is already here", async () => {
  const { adapter, client, conversation } = await startClient();
  await client.messages.list(conversation.id, { atLeast: 20 });
  adapter.pages = 0;

  await client.messages.list(conversation.id, { atLeast: 20 });

  assert.equal(adapter.pages, 0);
  await client.stop();
});

test("asking for nonsense is refused", async () => {
  const { client, conversation } = await startClient();

  await assert.rejects(client.messages.list(conversation.id, { atLeast: 0 }), /at least/i);
  await client.stop();
});
