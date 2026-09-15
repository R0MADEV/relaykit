import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { IndexedDbStorage } from "@relaykit/browser-storage";

let databaseCount = 0;
function aStore(options = { encryptionSecret: "device-secret" }) {
  databaseCount += 1;
  const name = `relaykit-privacy-${databaseCount}`;
  return { storage: new IndexedDbStorage(name, options), name };
}

/** Everything the database holds, as bytes on disk would hold it, whatever shape the records are. */
async function everythingWrittenDown(databaseName) {
  const stores = ["conversations", "messages", "outbox", "drafts", "profiles"];
  const opened = await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  const found = [];
  for (const store of [...opened.objectStoreNames].filter(name => stores.includes(name))) {
    const all = await new Promise((resolve, reject) => {
      const request = opened.transaction(store, "readonly").objectStore(store).getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    found.push(...all);
  }
  opened.close();
  return JSON.stringify(found);
}

const secretThings = {
  body: "la contrasena del wifi es hunter2",
  formattedBody: "<b>la contrasena del wifi es hunter2</b>",
  latitude: 43.263,
  longitude: -2.935
};

function aPrivateMessage(overrides = {}) {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    senderId: "alice",
    createdAt: 1,
    status: "sent",
    body: secretThings.body,
    formattedBody: secretThings.formattedBody,
    location: { latitude: secretThings.latitude, longitude: secretThings.longitude },
    ...overrides
  };
}

test("nothing a person said is legible on disk, in any of the shapes it is said in", async () => {
  const { storage, name } = aStore();
  await storage.saveMessage(aPrivateMessage());

  const onDisk = await everythingWrittenDown(name);

  // The same sentence three ways: as text, as the HTML that says it in bold, and as the place it was sent
  // from. All three are the thing somebody typed, and all three were readable before this test existed.
  assert.ok(!onDisk.includes(secretThings.body), "the message body is legible");
  assert.ok(!onDisk.includes("hunter2"), "the message is legible inside its HTML");
  assert.ok(!onDisk.includes("43.263"), "where somebody was is legible");
  assert.ok(!onDisk.includes("-2.935"), "where somebody was is legible");
});

test("what is still waiting to be sent is no more legible than what was", async () => {
  const { storage, name } = aStore();
  await storage.saveOutboxOperation({
    id: "operation-1",
    conversationId: "conversation-1",
    body: secretThings.body,
    formattedBody: secretThings.formattedBody,
    status: "pending",
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: 1
  });

  const onDisk = await everythingWrittenDown(name);

  assert.ok(!onDisk.includes("hunter2"), "a message that has not gone out yet is legible");
});

test("a draft nobody has sent is the most private thing there is", async () => {
  const { storage, name } = aStore();
  await storage.saveDraft("conversation-1", secretThings.body);

  assert.ok(!(await everythingWrittenDown(name)).includes("hunter2"));
});

test("what was written down comes back exactly as it was", async () => {
  const { storage } = aStore();
  const said = aPrivateMessage();
  await storage.saveMessage(said);

  const [read] = await storage.getMessages("conversation-1");

  assert.equal(read.body, said.body);
  assert.equal(read.formattedBody, said.formattedBody);
  assert.deepEqual(read.location, said.location);
});

test("a message with nothing private beyond its words still reads back whole", async () => {
  const { storage } = aStore();
  await storage.saveMessage(aPrivateMessage({ formattedBody: undefined, location: undefined }));

  const [read] = await storage.getMessages("conversation-1");

  assert.equal(read.body, secretThings.body);
  assert.equal(read.formattedBody, undefined);
  assert.equal(read.location, undefined);
});

test("a rekey that cannot finish leaves what was there, not half of it", async () => {
  const { storage } = aStore();
  await storage.saveConversation({
    id: "conversation-1",
    participantIds: ["alice", "bob"],
    membership: "join",
    isEncrypted: false
  });
  await storage.saveMessage(aPrivateMessage());
  await storage.saveProfiles([{ id: "bob", displayName: "Bob" }]);

  await storage.rekey("otro-secreto");

  // Everything readable with the new key, and the profiles still there: they were being cleared and never
  // written back, so a rekey that worked perfectly emptied that cache.
  assert.equal((await storage.getMessages("conversation-1"))[0].body, secretThings.body);
  assert.equal((await storage.getConversations()).length, 1);
  assert.equal(
    (await storage.getProfiles()).length,
    1,
    "the profiles were thrown away by a successful rekey"
  );
});
