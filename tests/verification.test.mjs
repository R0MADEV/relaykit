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

function collect(client, eventName) {
  const received = [];
  client.on(eventName, payload => received.push(payload));
  return received;
}

test("an outgoing verification reaches the SAS phase and completes on confirm", async () => {
  const { client } = await startClient();
  const changes = collect(client, "verification.changed");

  const requested = await client.verification.request("alice", "ALICE-2");
  assert.equal(requested.phase, "requested");
  assert.equal(requested.initiatedByMe, true);
  assert.equal(requested.otherDeviceId, "ALICE-2");

  const sas = changes.find(change => change.phase === "sas");
  assert.ok(sas, "the session should reach the SAS phase once the other side accepts");
  assert.equal(sas.id, requested.id);
  assert.ok(sas.sas.emoji.length > 0);
  assert.ok(sas.sas.emoji.every(item => typeof item.symbol === "string" && typeof item.name === "string"));

  const done = await client.verification.confirm(requested.id);
  assert.equal(done.phase, "done");
  assert.equal(changes.at(-1).phase, "done");
  await client.stop();
});

test("an incoming verification is emitted and can be accepted and rejected", async () => {
  const { adapter, client } = await startClient();
  const requests = collect(client, "verification.requested");
  const changes = collect(client, "verification.changed");

  adapter.receiveVerificationRequest("alice", "ALICE-3");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].phase, "requested");
  assert.equal(requests[0].initiatedByMe, false);

  const accepted = await client.verification.accept(requests[0].id);
  assert.equal(accepted.phase, "sas");
  assert.ok(accepted.sas);

  const rejected = await client.verification.reject(requests[0].id);
  assert.equal(rejected.phase, "cancelled");
  assert.equal(rejected.cancellationReason, "mismatch");
  assert.equal(changes.at(-1).phase, "cancelled");
  await client.stop();
});

test("a verification can be cancelled and unknown sessions are rejected", async () => {
  const { client } = await startClient();
  const requested = await client.verification.request("alice", "ALICE-2");

  const cancelled = await client.verification.cancel(requested.id);
  assert.equal(cancelled.phase, "cancelled");

  await assert.rejects(client.verification.confirm("missing"), { code: "VERIFICATION_NOT_FOUND" });
  await assert.rejects(client.verification.request("", "ALICE-2"), { code: "INVALID_INPUT" });
  await client.stop();
});
