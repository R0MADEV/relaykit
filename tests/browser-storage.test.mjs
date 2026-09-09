import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { IndexedDbStorage } from "@relaykit/browser-storage";
import { InMemoryAdapter } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };
const secret = "device-secret";
let databaseCount = 0;

function createStorage(options = { encryptionSecret: secret }) {
  databaseCount += 1;
  const name = `relaykit-test-${databaseCount}`;
  return { storage: new IndexedDbStorage(name, options), name };
}

function readRaw(databaseName, storeName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const getAll = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      getAll.onerror = () => reject(getAll.error);
      getAll.onsuccess = () => {
        database.close();
        resolve(getAll.result);
      };
    };
  });
}

function message(overrides = {}) {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    senderId: "alice",
    body: "Hola. Esto es secreto",
    createdAt: 1000,
    status: "sent",
    ...overrides
  };
}

test("messages round trip and are encrypted at rest", async () => {
  const { storage, name } = createStorage();

  await storage.saveMessage(message());

  assert.deepEqual(await storage.getMessage("message-1"), message());
  const [stored] = await readRaw(name, "messages");
  assert.notEqual(stored.body, message().body);
  assert.match(stored.body, /^[^.]+\.[^.]+$/);
});

test("messages are listed by conversation and by pending status", async () => {
  const { storage } = createStorage();
  await storage.saveMessage(message());
  await storage.saveMessage(message({ id: "message-2", body: "otra", status: "failed" }));
  await storage.saveMessage(message({ id: "message-3", conversationId: "conversation-2", body: "otra sala" }));

  const inConversation = await storage.getMessages("conversation-1");
  const pending = await storage.getPendingMessages();

  assert.deepEqual(inConversation.map(item => item.id).sort(), ["message-1", "message-2"]);
  assert.deepEqual(pending.map(item => item.body), ["otra"]);
  assert.deepEqual((await storage.getMessages("conversation-2")).map(item => item.body), ["otra sala"]);
});

test("a conversation keeps its last message readable", async () => {
  const { storage, name } = createStorage();

  await storage.saveConversation({ id: "conversation-1", participantIds: ["bob"], lastMessage: message() });

  const [conversation] = await storage.getConversations();
  assert.equal(conversation.lastMessage.body, message().body);
  const [stored] = await readRaw(name, "conversations");
  assert.notEqual(stored.lastMessage.body, message().body);
});

test("outbox attachments survive the round trip and are encrypted at rest", async () => {
  const { storage, name } = createStorage();
  const data = new Uint8Array([0, 1, 2, 250, 251, 255]);
  const operation = {
    id: "local-1",
    transactionId: "txn-1",
    conversationId: "conversation-1",
    body: "notes.txt",
    status: "pending",
    attempts: 0,
    nextAttemptAt: 500,
    createdAt: 400,
    attachment: { name: "notes.txt", mimeType: "text/plain", data }
  };

  await storage.saveOutboxOperation(operation);

  const restored = await storage.getOutboxOperation("local-1");
  assert.deepEqual(restored.attachment.data, data);
  assert.equal(restored.body, "notes.txt");
  const [stored] = await readRaw(name, "outbox");
  assert.notDeepEqual(stored.attachment.data, data);
  assert.equal(stored.attachment.data.byteLength, data.byteLength + 12 + 16);
});

test("getReadyOutbox only returns operations whose next attempt is due", async () => {
  const { storage } = createStorage();
  const base = { transactionId: "txn", conversationId: "conversation-1", body: "body", status: "pending", attempts: 0, createdAt: 1 };
  await storage.saveOutboxOperation({ ...base, id: "due", nextAttemptAt: 100 });
  await storage.saveOutboxOperation({ ...base, id: "later", nextAttemptAt: 5000 });
  await storage.saveOutboxOperation({ ...base, id: "exhausted", nextAttemptAt: Number.POSITIVE_INFINITY });

  assert.deepEqual((await storage.getReadyOutbox(1000)).map(item => item.id), ["due"]);
  assert.deepEqual((await storage.getReadyOutbox(Number.MAX_SAFE_INTEGER)).map(item => item.id).sort(), ["due", "later"]);
  await storage.deleteOutboxOperation("due");
  assert.deepEqual((await storage.getReadyOutbox(1000)).map(item => item.id), []);
});

test("clear empties conversations, messages and outbox", async () => {
  const { storage } = createStorage();
  await storage.saveConversation({ id: "conversation-1", participantIds: ["bob"] });
  await storage.saveMessage(message());
  await storage.saveOutboxOperation({
    id: "local-1", transactionId: "txn", conversationId: "conversation-1", body: "body",
    status: "pending", attempts: 0, nextAttemptAt: 0, createdAt: 1
  });

  await storage.clear();

  assert.deepEqual(await storage.getConversations(), []);
  assert.deepEqual(await storage.getMessages("conversation-1"), []);
  assert.deepEqual(await storage.getReadyOutbox(Number.MAX_SAFE_INTEGER), []);
});

test("without an encryption secret the content is stored as given", async () => {
  const { storage, name } = createStorage({});
  const data = new Uint8Array([7, 8, 9]);
  await storage.saveMessage(message());
  await storage.saveOutboxOperation({
    id: "local-1", transactionId: "txn", conversationId: "conversation-1", body: "notes.txt",
    status: "pending", attempts: 0, nextAttemptAt: 0, createdAt: 1,
    attachment: { name: "notes.txt", mimeType: "text/plain", data }
  });

  const [stored] = await readRaw(name, "messages");
  assert.equal(stored.body, message().body);
  assert.deepEqual((await storage.getOutboxOperation("local-1")).attachment.data, data);
});

test("the client works against IndexedDB and recovers a queued send after a restart", async () => {
  class FailingOnceAdapter extends InMemoryAdapter {
    failuresLeft = 0;

    async sendMessage(conversationId, body, transactionId) {
      if (this.failuresLeft > 0) {
        this.failuresLeft -= 1;
        throw new Error("temporary failure");
      }
      return super.sendMessage(conversationId, body, transactionId);
    }
  }

  const adapter = new FailingOnceAdapter();
  const { storage } = createStorage();
  const first = new MessagingClient({ adapter, storage, session });
  await first.start();
  const conversation = await first.conversations.create({ participantIds: ["bob"] });
  await first.messages.send(conversation.id, "primero");
  adapter.failuresLeft = 1;
  await assert.rejects(first.messages.send(conversation.id, "pendiente"));
  await first.stop();

  const failed = (await storage.getMessages(conversation.id)).find(item => item.body === "pendiente");
  assert.equal(failed.status, "failed");
  const operation = await storage.getOutboxOperation(failed.id);
  await storage.saveOutboxOperation({ ...operation, nextAttemptAt: 0 });

  const second = new MessagingClient({ adapter, storage, session });
  await second.start();
  const messages = await second.messages.list(conversation.id);

  assert.deepEqual(messages.map(item => item.body).sort(), ["pendiente", "primero"]);
  assert.equal(messages.every(item => item.status === "sent"), true);
  assert.deepEqual(await storage.getReadyOutbox(Number.MAX_SAFE_INTEGER), []);

  await second.logout();
  assert.deepEqual(await storage.getConversations(), []);
});

test("records that cannot be decrypted are skipped instead of breaking every read", async () => {
  databaseCount += 1;
  const name = `relaykit-test-${databaseCount}`;
  const data = new Uint8Array([1, 2, 3]);
  const original = new IndexedDbStorage(name, { encryptionSecret: "old-secret" });
  await original.saveMessage(message());
  await original.saveConversation({ id: "conversation-1", participantIds: ["bob"], lastMessage: message() });
  await original.saveOutboxOperation({
    id: "local-1", transactionId: "txn", conversationId: "conversation-1", body: "notes.txt",
    status: "pending", attempts: 0, nextAttemptAt: 0, createdAt: 1,
    attachment: { name: "notes.txt", mimeType: "text/plain", data }
  });

  // The device secret changed, so nothing written with the previous one can be read back.
  const rotated = new IndexedDbStorage(name, { encryptionSecret: "new-secret" });

  assert.equal(await rotated.getMessage("message-1"), undefined);
  assert.deepEqual(await rotated.getMessages("conversation-1"), []);
  assert.deepEqual(await rotated.getPendingMessages(), []);
  assert.deepEqual(await rotated.getReadyOutbox(Number.MAX_SAFE_INTEGER), []);
  assert.equal(await rotated.getOutboxOperation("local-1"), undefined);
  const [conversation] = await rotated.getConversations();
  assert.equal(conversation.id, "conversation-1");
  assert.equal(conversation.lastMessage, undefined);
});

test("readable records survive alongside records written with another secret", async () => {
  databaseCount += 1;
  const name = `relaykit-test-${databaseCount}`;
  await new IndexedDbStorage(name, { encryptionSecret: "old-secret" }).saveMessage(message());
  const storage = new IndexedDbStorage(name, { encryptionSecret: "new-secret" });
  await storage.saveMessage(message({ id: "message-2", body: "legible" }));

  const messages = await storage.getMessages("conversation-1");

  assert.deepEqual(messages.map(item => item.body), ["legible"]);
});

test("the web client persists locally when the session comes from login, not only from the constructor", async () => {
  const { MessagingClient: WebMessagingClient } = await import("@relaykit/web");
  const client = new WebMessagingClient({ adapter: new InMemoryAdapter() });

  await client.login({ homeserver: "memory://test", username: "alice", password: "secret" });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  await client.messages.send(conversation.id, "persistido");

  const databases = (await indexedDB.databases()).map(database => database.name);
  assert.ok(databases.includes("relaykit-app-alice"), `expected the store to exist, found ${databases.join(", ")}`);
  assert.deepEqual((await client.messages.list(conversation.id)).map(message => message.body), ["persistido"]);
  await client.stop();
});

test("a queued thumbnail is encrypted at rest and restored with the file", async () => {
  const { storage, name } = createStorage();
  const data = new Uint8Array([1, 2, 3, 4]);
  const thumbnail = new Uint8Array([9, 9]);

  await storage.saveOutboxOperation({
    id: "local-1", transactionId: "txn", conversationId: "conversation-1", body: "foto.jpg",
    status: "pending", attempts: 0, nextAttemptAt: 0, createdAt: 1,
    attachment: { name: "foto.jpg", mimeType: "image/jpeg", data, thumbnail: { mimeType: "image/jpeg", data: thumbnail } }
  });

  const restored = await storage.getOutboxOperation("local-1");
  assert.deepEqual(restored.attachment.data, data);
  assert.deepEqual(restored.attachment.thumbnail.data, thumbnail);
  const [stored] = await readRaw(name, "outbox");
  assert.notDeepEqual(stored.attachment.thumbnail.data, thumbnail);
});
