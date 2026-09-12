import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { IndexedDbStorage } from "@relaykit/browser-storage";

let databaseCount = 0;

function nextName() {
  databaseCount += 1;
  return `relaykit-index-${databaseCount}`;
}

function message(id, conversationId, overrides = {}) {
  return {
    id,
    conversationId,
    senderId: "bob",
    body: `cuerpo de ${id}`,
    createdAt: 1000,
    status: "sent",
    ...overrides
  };
}

/** Opens whatever is already there, without asking for a version, so it never waits for another connection. */
function openExisting(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function indexNamesOf(database, storeName) {
  return [...database.transaction(storeName, "readonly").objectStore(storeName).indexNames];
}

function openRaw(name, version) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const store of ["conversations", "messages", "outbox", "drafts"]) {
        if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: "id" });
      }
    };
  });
}

test("reading one conversation does not walk every message ever kept", async () => {
  const name = nextName();
  const storage = new IndexedDbStorage(name);
  await storage.saveMessages([message("a1", "one"), message("b1", "two"), message("a2", "one")]);

  const kept = await storage.getMessages("one");

  assert.deepEqual(kept.map(item => item.id).sort(), ["a1", "a2"]);
  const database = await openExisting(name);
  const indexes = indexNamesOf(database, "messages");
  assert.ok(indexes.includes("conversationId"), `the store must be indexed by conversation: ${indexes}`);
  database.close();
});

test("the queue does not walk every message either", async () => {
  const name = nextName();
  const storage = new IndexedDbStorage(name);
  await storage.saveMessages([
    message("sent-1", "one"),
    message("queued-1", "one", { status: "queued" }),
    message("failed-1", "two", { status: "failed" })
  ]);

  const pending = await storage.getPendingMessages();

  assert.deepEqual(pending.map(item => item.id).sort(), ["failed-1", "queued-1"]);
  const database = await openExisting(name);
  const indexes = indexNamesOf(database, "messages");
  assert.ok(indexes.includes("status"), `the store must be indexed by status: ${indexes}`);
  database.close();
});

test("a store made before there were indexes gets them when it is opened again", async () => {
  const name = nextName();
  const old = await openRaw(name, 3);
  old.close();

  const storage = new IndexedDbStorage(name);
  await storage.saveMessages([message("a1", "one"), message("b1", "two")]);

  assert.deepEqual((await storage.getMessages("one")).map(item => item.id), ["a1"]);
});

test("messages written before the indexes existed are still found afterwards", async () => {
  const name = nextName();
  const old = await openRaw(name, 3);
  await new Promise((resolve, reject) => {
    const put = old.transaction("messages", "readwrite").objectStore("messages").put(message("old-1", "one"));
    put.onsuccess = () => resolve();
    put.onerror = () => reject(put.error);
  });
  old.close();

  const storage = new IndexedDbStorage(name);

  assert.deepEqual((await storage.getMessages("one")).map(item => item.id), ["old-1"]);
});
