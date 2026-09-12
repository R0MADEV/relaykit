import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token", deviceId: "ALICE-1" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

async function requestedSession(client, options) {
  const started = await client.verification.request("alice", "ALICE-2", options);
  await new Promise(resolve => setTimeout(resolve, 0));
  return started;
}

test("a verification asked for by emoji goes to comparing emoji on its own", async () => {
  const { client } = await startClient();
  const seen = [];
  client.on("verification.changed", update => seen.push(update));

  await requestedSession(client);

  const sas = seen.find(update => update.phase === "sas");
  assert.ok(sas?.sas.emoji.length > 0, `no emoji phase in ${seen.map(item => item.phase).join(", ")}`);
  await client.stop();
});

test("a verification asked for by code does not start comparing emoji behind the caller's back", async () => {
  const { client } = await startClient();
  const seen = [];
  client.on("verification.changed", update => seen.push(update));

  const started = await requestedSession(client, { method: "code" });
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.ok(
    seen.every(update => update.phase !== "sas"),
    `emoji started on its own: ${seen.map(item => item.phase).join(", ")}`
  );
  const current = await client.verification.qrCode(started.id);
  const scanned = await client.verification.scan(started.id, current);
  assert.equal(scanned.phase, "done");
  await client.stop();
});

test("a way of verifying nobody understands is refused", async () => {
  const { client } = await startClient();

  await assert.rejects(client.verification.request("alice", "ALICE-2", { method: "smoke" }), /method/i);
  await client.stop();
});

test("a verification can be shown as a code for the other device to scan", async () => {
  const { client } = await startClient();
  const started = await requestedSession(client);

  const code = await client.verification.qrCode(started.id);

  assert.ok(code instanceof Uint8Array);
  assert.ok(code.byteLength > 0);
  await client.stop();
});

test("scanning the code from the other device finishes the verification", async () => {
  const { client } = await startClient();
  const started = await requestedSession(client);
  const code = await client.verification.qrCode(started.id);

  const scanned = await client.verification.scan(started.id, code);

  assert.equal(scanned.phase, "done");
  await client.stop();
});

test("a code that is not the one this verification made is refused", async () => {
  const { client } = await startClient();
  const started = await requestedSession(client);

  await assert.rejects(client.verification.scan(started.id, new Uint8Array([9, 9, 9])), /code/i);
  await client.stop();
});

test("asking for the code of a verification that does not exist says so", async () => {
  const { client } = await startClient();

  await assert.rejects(client.verification.qrCode("no-existe"), /does not exist/i);
  await client.stop();
});

test("a verification nobody can show as a code says so instead of pretending", async () => {
  const { adapter, client } = await startClient();
  adapter.disableQrCodes();
  const started = await requestedSession(client);

  assert.equal(await client.verification.qrCode(started.id), undefined);
  await client.stop();
});
