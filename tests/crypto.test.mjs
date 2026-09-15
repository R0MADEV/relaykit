import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const client = new MessagingClient({
    adapter: new InMemoryAdapter(),
    storage: new InMemoryStorage(),
    session
  });
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

test("a recovery key that is not this account's is the caller's mistake, not the server's", async () => {
  const client = await startClient();
  await client.crypto.setupRecovery();

  // Bad input rather than a backend failure: nothing went wrong anywhere, the key is simply not the one.
  await assert.rejects(client.crypto.recover("wrong key"), { code: "INVALID_INPUT" });
  await client.stop();
});

test("recover validates the recovery key input", async () => {
  const client = await startClient();

  await assert.rejects(client.crypto.recover("   "), { code: "INVALID_INPUT" });
  await client.stop();
});
