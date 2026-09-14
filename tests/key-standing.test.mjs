import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";
import { keyStanding } from "../packages/core/dist/crypto-operations.js";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

test("an account that never protected its keys has nothing to restore", () => {
  const standing = keyStanding(
    { crossSigningReady: false, secretStorageReady: false },
    { activeVersion: null }
  );
  assert.equal(standing, "never-protected");
});

test("a backup this device cannot read is locked, however trusted the device is", () => {
  assert.equal(
    keyStanding({ crossSigningReady: true, secretStorageReady: true }, { activeVersion: "1" }),
    "locked"
  );
  assert.equal(
    keyStanding(
      { crossSigningReady: true, secretStorageReady: true },
      { activeVersion: "1", matchesDecryptionKey: false }
    ),
    "locked"
  );
});

test("a device that was never let in is locked even where there is no backup of messages", () => {
  assert.equal(
    keyStanding({ crossSigningReady: false, secretStorageReady: true }, { activeVersion: null }),
    "locked"
  );
});

test("a device holding the key to a backup it trusts is ready", () => {
  assert.equal(
    keyStanding(
      { crossSigningReady: true, secretStorageReady: true },
      { activeVersion: "1", matchesDecryptionKey: true }
    ),
    "ready"
  );
});

test("nothing was ever backed up, and this device is let in: there is nothing left to do", () => {
  assert.equal(
    keyStanding({ crossSigningReady: true, secretStorageReady: true }, { activeVersion: null }),
    "ready"
  );
});

test("a client says how its keys stand, and says it differently once recovery is set up", async () => {
  const client = new MessagingClient({
    adapter: new InMemoryAdapter(),
    storage: new InMemoryStorage(),
    session
  });
  await client.start();

  assert.equal(await client.crypto.standing(), "never-protected");
  await client.crypto.setupRecovery();

  assert.equal(await client.crypto.standing(), "ready");
  await client.stop();
});
