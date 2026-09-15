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

test("a field nobody thought about is private, not legible", async () => {
  const { storage, name } = aStore();
  // Standing in for the next private thing somebody adds to the model without touching this file. Blacklists
  // are wrong by default; the question a store should ask is what may be left out, not what must go in.
  await storage.saveMessage({ ...aPrivateMessage(), caption: "el pie de foto tambien es privado" });

  assert.ok(!(await everythingWrittenDown(name)).includes("el pie de foto"));
});

test("what the database has to index with stays legible, and nothing else does", async () => {
  const { storage, name } = aStore();
  await storage.saveMessage(aPrivateMessage({ status: "sent" }));

  const onDisk = await everythingWrittenDown(name);

  // Without these the store cannot find anything: it looks messages up by id, by conversation and by status.
  assert.ok(onDisk.includes("message-1"));
  assert.ok(onDisk.includes("conversation-1"));
  assert.ok(onDisk.includes('"status":"sent"'));
});

test("a message that reads like this library's own record is still just what somebody typed", async () => {
  const { storage } = aStore();
  // Somebody pasting JSON into a chat should get their JSON back, not have it read as bookkeeping.
  const typedByHand = '{"body":"esto lo escribio una persona"}';
  await storage.saveMessage(
    aPrivateMessage({ body: typedByHand, formattedBody: undefined, location: undefined })
  );

  const [read] = await storage.getMessages("conversation-1");

  assert.equal(read.body, typedByHand);
});

test("what is waiting to go out comes back with its formatting", async () => {
  const { storage } = aStore();
  await storage.saveOutboxOperation({
    id: "operation-1",
    transactionId: "txn-1",
    conversationId: "conversation-1",
    body: "hola",
    formattedBody: "<b>hola</b>",
    status: "pending",
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: 1
  });

  const read = await storage.getOutboxOperation("operation-1");

  assert.equal(read.body, "hola");
  assert.equal(read.formattedBody, "<b>hola</b>", "the formatting was sealed away and never let back out");
});

test("a message with a full stop in it is not mistaken for something encrypted", async () => {
  const { storage, name } = aStore({});
  await storage.saveMessage(
    aPrivateMessage({ body: "Hola. Que tal?", formattedBody: undefined, location: undefined })
  );
  const openStore = new IndexedDbStorage(name, { encryptionSecret: "una-clave-que-llega-despues" });

  // Written with no key, read with one. Guessing by looking for a dot means anything anybody said with a
  // full stop in it looks like ciphertext and is thrown away.
  const [read] = await openStore.getMessages("conversation-1");

  assert.equal(read?.body, "Hola. Que tal?");
});

test("a rekey that cannot read what is there changes nothing", async () => {
  const { storage, name } = aStore({ encryptionSecret: "la-clave-de-verdad" });
  await storage.saveOutboxOperation({
    id: "operation-1",
    transactionId: "txn-1",
    conversationId: "conversation-1",
    body: "esto no se ha enviado",
    status: "pending",
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: 1
  });

  const withTheWrongKey = new IndexedDbStorage(name, { encryptionSecret: "la-que-no-es" });
  await assert.rejects(withTheWrongKey.rekey("una-tercera"), /could not be read/i);

  // Until that moment nothing was lost: it was the wrong key, not broken data. Rewriting the database with
  // what could be read would have thrown away the only copy of something never sent.
  const withTheRightOne = new IndexedDbStorage(name, { encryptionSecret: "la-clave-de-verdad" });
  assert.equal((await withTheRightOne.getReadyOutbox(Date.now()))[0]?.body, "esto no se ha enviado");
});

test("a rekey that fails leaves the instance able to read what is still there", async () => {
  const { storage } = aStore({ encryptionSecret: "la-primera" });
  await storage.saveMessage(aPrivateMessage());
  await storage.rekey("la-segunda").catch(() => undefined);

  // Whatever happened, the key this instance holds and the key the database is under are the same one.
  assert.equal((await storage.getMessages("conversation-1"))[0]?.body, secretThings.body);
});

test("how the key was made is written down beside the data", async () => {
  const { storage } = aStore({ passphrase: { typed: "una frase", salt: "sal" } });
  await storage.saveMessage(aPrivateMessage());

  const howItWasMade = await storage.howItIsLocked();

  // So that raising the work factor in two years can still open what is already there instead of locking
  // somebody out of their own conversations.
  assert.equal(howItWasMade.kdf, "pbkdf2-sha256");
  assert.equal(howItWasMade.iterations, 600_000);
  assert.equal(howItWasMade.salt, "sal");
});

test("a rekey can move a copy from one typed passphrase to another", async () => {
  const { storage, name } = aStore({ passphrase: { typed: "la primera frase", salt: "sal-uno" } });
  await storage.saveMessage(aPrivateMessage());

  await storage.rekey({ passphrase: { typed: "la segunda frase", salt: "sal-dos" } });

  const reopened = new IndexedDbStorage(name, { passphrase: { typed: "la segunda frase", salt: "sal-dos" } });
  assert.equal((await reopened.getMessages("conversation-1"))[0]?.body, secretThings.body);
});
