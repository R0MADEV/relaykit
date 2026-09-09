import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage: new InMemoryStorage(), session });
  await client.start();
  return client;
}

test("setupRecovery returns a recovery key that can restore the backup", async () => {
  const client = await startClient();

  const { recoveryKey } = await client.crypto.setupRecovery();
  const summary = await client.crypto.recover(recoveryKey);

  assert.equal(typeof recoveryKey, "string");
  assert.ok(recoveryKey.length > 0);
  assert.deepEqual(summary, { total: 0, imported: 0 });
  assert.equal((await client.crypto.backupStatus()).activeVersion !== null, true);
  await client.stop();
});

test("recover rejects an unknown recovery key with an adapter error", async () => {
  const client = await startClient();
  await client.crypto.setupRecovery();

  await assert.rejects(client.crypto.recover("wrong key"), { code: "ADAPTER_ERROR" });
  await client.stop();
});

test("recover validates the recovery key input", async () => {
  const client = await startClient();

  await assert.rejects(client.crypto.recover("   "), { code: "INVALID_INPUT" });
  await client.stop();
});
