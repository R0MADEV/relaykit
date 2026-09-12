import { IndexedDbStorage, MessagingClient } from "@relaykit/web";

declare global {
  interface Window {
    readonly relaykit: { getStorageSecret(): Promise<string> };
  }
}

const homeserver = "http://localhost:8008";
const alice = { username: "alice", password: "alice-password" };
const bobUserId = "@bob:localhost";

function report(ok: boolean, summary: string, detail: unknown = {}): void {
  console.log(`RELAYKIT_RESULT ${JSON.stringify({ ok, summary, detail })}`);
}

async function relaykitDatabases(): Promise<string[]> {
  const databases = await indexedDB.databases();
  return databases.map(database => database.name ?? "").filter(name => name.startsWith("relaykit-app"));
}

function readStoredMessages(databaseName: string): Promise<{ body: string }[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const getAll = database.transaction("messages", "readonly").objectStore("messages").getAll();
      getAll.onerror = () => reject(getAll.error);
      getAll.onsuccess = () => {
        database.close();
        resolve(getAll.result);
      };
    };
  });
}

async function waitFor<T>(check: () => Promise<T | undefined>, attempts = 40): Promise<T | undefined> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check();
    if (result !== undefined) return result;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return undefined;
}

function step(name: string): void {
  console.log(`RELAYKIT_STEP ${name}`);
}

async function run(): Promise<void> {
  const detail: Record<string, unknown> = {};

  // The key that encrypts the local store comes from the operating system keychain, never from the token.
  const storageSecret = await window.relaykit.getStorageSecret();
  detail.storageSecretIsStable = storageSecret === await window.relaykit.getStorageSecret();

  // Anything left by a previous run must still be readable, which proves the keychain secret is stable.
  const previous = new IndexedDbStorage("relaykit-app-@alice:localhost", { encryptionSecret: storageSecret });
  // A marker written by the previous run: reading it back proves the keychain secret survives a restart.
  const marker = await previous.getMessage("relaykit-restart-probe");
  detail.readMarkerFromPreviousRun = marker?.body ?? null;
  await previous.saveMessage({
    id: "relaykit-restart-probe",
    conversationId: "relaykit-restart-probe",
    senderId: "@alice:localhost",
    body: `written-at-${Date.now()}`,
    createdAt: Date.now(),
    status: "sent"
  });

  // The flow the README documents: build the client, then log in.
  const client = new MessagingClient({ storageSecret });
  step("client.login");
  const session = await client.login({ ...alice, homeserver, deviceName: "RelayKit Electron" });
  step("client.start");
  await client.start();
  step("client.conversations.create");
  const conversation = await client.conversations.create({ participantIds: [bobUserId], title: "RelayKit Electron" });
  const body = `electron-${Date.now()}`;
  step("client.messages.send");
  await client.messages.send(conversation.id, body);
  detail.databasesAfterLoginFlow = await relaykitDatabases();
  await client.stop();

  // The restore flow: the session is known when the client is built.
  step("const restored = new-MessagingClient");
  const restored = new MessagingClient({ session, storageSecret });
  step("restored.start");
  await restored.start();
  // A restarted client shows its cached view first and catches up moments later.
  step("restored.messages.list");
  detail.restoredMessages = await waitFor(async () => {
    const messages = await restored.messages.list(conversation.id);
    const found = messages.filter(message => message.body === body).length;
    return found > 0 ? found : undefined;
  });

  const data = new Uint8Array(48).map((_, index) => (index * 7) % 256);
  step("restored.messages.sendFile");
  const sent = await restored.messages.sendFile(conversation.id, {
    name: "electron.bin",
    mimeType: "application/octet-stream",
    data
  });
  step("restored.media.download");
  const downloaded = await restored.media.download(sent.attachment!);
  detail.attachmentRoundTrip = downloaded.length === data.length && downloaded.every((byte, index) => byte === data[index]);

  // What sending costs against the real IndexedDB of a browser, which is the number that matters. The tests
  // measure against a JavaScript stand-in, and that one is far slower than the real thing.
  const howMany = 20;
  const startedSending = performance.now();
  for (let index = 0; index < howMany; index += 1) {
    await restored.messages.send(conversation.id, `medida ${index}`);
  }
  detail.millisecondsPerSend = Number(((performance.now() - startedSending) / howMany).toFixed(2));

  // Opening a conversation is all local, so this is the number the storage work actually moves.
  await restored.messages.list(conversation.id);
  const startedOpening = performance.now();
  await restored.messages.list(conversation.id);
  detail.millisecondsToOpenAConversation = Number((performance.now() - startedOpening).toFixed(2));

  // Changing the secret against the real IndexedDB of a browser, which is where the transactions and the schema
  // behave for real. Everything kept has to still be readable afterwards.
  step("storage.rekey");
  const before = await previous.getMessages(conversation.id);
  await previous.rekey(`${storageSecret}-rotated`);
  const after = await previous.getMessages(conversation.id);
  detail.messagesBeforeRekey = before.length;
  detail.messagesAfterRekey = after.length;
  detail.rekeyKeptEverything = before.length > 0 && before.length === after.length
    && before.every((message, index) => message.body === after[index]?.body);
  await previous.rekey(storageSecret);

  const databases = await relaykitDatabases();
  detail.databasesAfterRestoreFlow = databases;
  const stored = databases[0] ? await readStoredMessages(databases[0]) : [];
  detail.storedMessages = stored.length;
  detail.storedBodiesAreEncrypted = stored.length > 0 && stored.every(message => message.body !== body);
  await restored.stop();

  const persistedOnLoginFlow = (detail.databasesAfterLoginFlow as string[]).length > 0;
  const ok = detail.rekeyKeptEverything === true
    && detail.storageSecretIsStable === true
    && detail.attachmentRoundTrip === true
    && detail.storedBodiesAreEncrypted === true
    && (detail.restoredMessages as number) > 0
    && persistedOnLoginFlow;
  report(ok, ok
    ? "encrypted chat, attachments and encrypted IndexedDB storage work in a Chromium renderer"
    : "the SDK ran but did not behave as expected", detail);
}

run().catch(error => report(false, error instanceof Error ? error.message : String(error)));
