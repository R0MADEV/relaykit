import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryAdapter,
  InMemoryStorage
} from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

test("public client creates a conversation and sends a message", async () => {
  const adapter = new InMemoryAdapter();
  const storage = new InMemoryStorage();
  const client = new MessagingClient({
    adapter,
    storage,
    session: {
      homeserver: "memory://test",
      userId: "alice",
      accessToken: "token"
    }
  });

  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  const message = await client.messages.send(conversation.id, "hello");

  assert.equal(message.body, "hello");
  assert.equal(message.status, "sent");
  assert.equal((await client.messages.list(conversation.id)).length, 1);

  await client.stop();
});

test("outbox persists a failed send and retries it", async () => {
  class FailingOnceAdapter extends InMemoryAdapter {
    attempts = 0;

    async sendMessage(conversationId, body, transactionId) {
      this.attempts += 1;
      if (this.attempts === 1) {
        throw new Error("temporary failure");
      }
      return super.sendMessage(conversationId, body, transactionId);
    }
  }

  const adapter = new FailingOnceAdapter();
  const storage = new InMemoryStorage();
  const client = new MessagingClient({
    adapter,
    storage,
    session: {
      homeserver: "memory://test",
      userId: "alice",
      accessToken: "token"
    }
  });

  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  await assert.rejects(client.messages.send(conversation.id, "retry me"));

  const failed = (await client.messages.list(conversation.id)).find(message => message.status === "failed");
  assert.ok(failed);
  const sent = await client.messages.retry(failed.id);

  assert.equal(sent.status, "sent");
  assert.equal((await client.messages.list(conversation.id)).filter(message => message.body === "retry me").length, 1);
  await client.stop();
});

test("public validation rejects invalid conversation and message input", async () => {
  const client = new MessagingClient({
    adapter: new InMemoryAdapter(),
    session: {
      homeserver: "memory://test",
      userId: "alice",
      accessToken: "token"
    }
  });

  await client.start();
  await assert.rejects(
    client.conversations.create({ participantIds: ["bob", "bob"] }),
    { code: "INVALID_INPUT" }
  );
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  await assert.rejects(
    client.messages.send(conversation.id, "   "),
    { code: "INVALID_INPUT" }
  );
  await client.stop();
});

test("loadMore returns the known timeline and whether older history remains", async () => {
  class PagingAdapter extends InMemoryAdapter {
    hasMore = true;
    requestedLimits = [];

    async loadMoreMessages(conversationId, limit) {
      this.requestedLimits.push(limit);
      return { messages: await this.listMessages(conversationId), hasMore: this.hasMore };
    }
  }

  const adapter = new PagingAdapter();
  const client = new MessagingClient({
    adapter,
    storage: new InMemoryStorage(),
    session: { homeserver: "memory://test", userId: "alice", accessToken: "token" }
  });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  await client.messages.send(conversation.id, "uno");

  const page = await client.messages.loadMore(conversation.id, 10);
  assert.deepEqual(page.messages.map(message => message.body), ["uno"]);
  assert.equal(page.hasMore, true);
  assert.deepEqual(adapter.requestedLimits, [10]);

  adapter.hasMore = false;
  assert.equal((await client.messages.loadMore(conversation.id)).hasMore, false);
  await assert.rejects(client.messages.loadMore(conversation.id, 0), { code: "INVALID_INPUT" });
  await client.stop();
});

test("loadMore falls back to the stored timeline when history cannot be fetched", async () => {
  class OfflineAdapter extends InMemoryAdapter {
    async loadMoreMessages() {
      throw new Error("network unavailable");
    }
  }

  const storage = new InMemoryStorage();
  const client = new MessagingClient({
    adapter: new OfflineAdapter(),
    storage,
    session: { homeserver: "memory://test", userId: "alice", accessToken: "token" }
  });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  await client.messages.send(conversation.id, "guardado");

  const page = await client.messages.loadMore(conversation.id, 10);

  assert.deepEqual(page.messages.map(message => message.body), ["guardado"]);
  assert.equal(page.hasMore, false);
  await client.stop();
});

test("a message can reply to another one", async () => {
  const client = new MessagingClient({
    adapter: new InMemoryAdapter(),
    storage: new InMemoryStorage(),
    session: { homeserver: "memory://test", userId: "alice", accessToken: "token" }
  });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  const original = await client.messages.send(conversation.id, "¿quedamos el martes?");

  const reply = await client.messages.send(conversation.id, "me viene bien", { replyTo: original.id });

  assert.equal(reply.replyToId, original.id);
  const listed = await client.messages.list(conversation.id);
  assert.equal(listed.find(message => message.id === reply.id).replyToId, original.id);
  assert.equal(listed.find(message => message.id === original.id).replyToId, undefined);
  await assert.rejects(client.messages.send(conversation.id, "vacío", { replyTo: "  " }), { code: "INVALID_INPUT" });
  await client.stop();
});

test("listing messages only writes the ones that changed", async () => {
  class CountingStorage extends InMemoryStorage {
    saves = 0;

    async saveMessage(message) {
      this.saves += 1;
      return super.saveMessage(message);
    }
  }

  const adapter = new InMemoryAdapter();
  const storage = new CountingStorage();
  const client = new MessagingClient({
    adapter,
    storage,
    session: { homeserver: "memory://test", userId: "alice", accessToken: "token" }
  });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  await client.messages.send(conversation.id, "uno");
  await client.messages.send(conversation.id, "dos");

  await client.messages.list(conversation.id);
  const afterFirstList = storage.saves;
  await client.messages.list(conversation.id);

  assert.equal(storage.saves, afterFirstList, "an unchanged timeline should not be written again");

  adapter.receiveMessage(conversation.id, "bob", "tres");
  await client.messages.list(conversation.id);

  assert.equal(storage.saves, afterFirstList + 1, "only the new message should be written");
  await client.stop();
});

test("the local cache keeps only the most recent messages of a conversation", async () => {
  const adapter = new InMemoryAdapter();
  const storage = new InMemoryStorage();
  const client = new MessagingClient({
    adapter,
    storage,
    session: { homeserver: "memory://test", userId: "alice", accessToken: "token" },
    cache: { messagesPerConversation: 3 }
  });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  for (const body of ["uno", "dos", "tres", "cuatro", "cinco"]) {
    await client.messages.send(conversation.id, body);
  }

  const listed = await client.messages.list(conversation.id);

  assert.equal(listed.length, 5, "what the caller gets back is not trimmed");
  const cached = await storage.getMessages(conversation.id);
  assert.deepEqual(cached.map(message => message.body), ["tres", "cuatro", "cinco"]);
  await client.stop();
});

test("a message still waiting to be sent is never dropped from the cache", async () => {
  class OfflineAdapter extends InMemoryAdapter {
    offline = false;

    async sendMessage(conversationId, body, ...rest) {
      if (this.offline) throw new Error("sin red");
      return super.sendMessage(conversationId, body, ...rest);
    }
  }

  const adapter = new OfflineAdapter();
  const storage = new InMemoryStorage();
  const client = new MessagingClient({
    adapter,
    storage,
    session: { homeserver: "memory://test", userId: "alice", accessToken: "token" },
    cache: { messagesPerConversation: 2 }
  });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  adapter.offline = true;
  await assert.rejects(client.messages.send(conversation.id, "pendiente"));
  adapter.offline = false;
  for (const body of ["uno", "dos", "tres"]) {
    await client.messages.send(conversation.id, body);
  }

  await client.messages.list(conversation.id);

  const cached = await storage.getMessages(conversation.id);
  assert.ok(cached.some(message => message.body === "pendiente"), "the queued message must survive");
  assert.deepEqual(cached.filter(message => message.status === "sent").map(message => message.body), ["dos", "tres"]);
  await client.stop();
});
