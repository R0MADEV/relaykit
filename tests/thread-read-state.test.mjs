import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient(adapter = new InMemoryAdapter()) {
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "hilos" });
  return { adapter, client, conversation };
}

test("the threads of a conversation can be listed without opening each one", async () => {
  const { client, conversation } = await startClient();
  const question = await client.messages.send(conversation.id, "¿alguien sabe esto?");
  await client.messages.send(conversation.id, "yo lo miro", { threadId: question.id });
  await client.messages.send(conversation.id, "ya está", { threadId: question.id });
  await client.messages.send(conversation.id, "otra cosa aparte");

  const threads = await client.messages.threads(conversation.id);

  assert.equal(threads.length, 1);
  assert.equal(threads[0].rootId, question.id);
  assert.equal(threads[0].replyCount, 2);
  assert.equal(threads[0].lastMessage.body, "ya está");
  await client.stop();
});

test("a conversation with nothing hanging off it has no threads", async () => {
  const { client, conversation } = await startClient();
  await client.messages.send(conversation.id, "sola");

  assert.deepEqual(await client.messages.threads(conversation.id), []);
  await client.stop();
});

test("reading a thread is told apart from reading the conversation", async () => {
  class WatchfulAdapter extends InMemoryAdapter {
    told;
    async markMessageRead(conversationId, messageId, options) {
      this.told = options;
      return super.markMessageRead(conversationId, messageId, options);
    }
  }
  const { adapter, client, conversation } = await startClient(new WatchfulAdapter());
  const question = await client.messages.send(conversation.id, "¿esto?");
  const answer = await client.messages.send(conversation.id, "esto", { threadId: question.id });

  await client.messages.markRead(conversation.id, answer.id, { threadId: question.id });

  assert.deepEqual(adapter.told, { threadId: question.id });
  await client.stop();
});

test("reading one thread does not say the other was read", async () => {
  const { client, conversation } = await startClient();
  const first = await client.messages.send(conversation.id, "primera");
  const second = await client.messages.send(conversation.id, "segunda");
  const inFirst = await client.messages.send(conversation.id, "a", { threadId: first.id });
  await client.messages.send(conversation.id, "b", { threadId: second.id });

  await client.messages.markRead(conversation.id, inFirst.id, { threadId: first.id });

  const threads = await client.messages.threads(conversation.id);
  const readOne = threads.find(thread => thread.rootId === first.id);
  const otherOne = threads.find(thread => thread.rootId === second.id);
  assert.equal(readOne.lastReadMessageId, inFirst.id);
  assert.equal(otherOne.lastReadMessageId, undefined);
  await client.stop();
});
