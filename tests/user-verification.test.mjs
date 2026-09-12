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

test("another person can be verified without naming any of their devices", async () => {
  const { client } = await startClient();

  const started = await client.verification.request("bob");

  assert.equal(started.otherUserId, "bob");
  assert.equal(started.otherDeviceId, undefined);
  await client.stop();
});

test("verifying another person happens in the conversation the two of them share", async () => {
  const { adapter, client } = await startClient();

  await client.verification.request("bob");

  const direct = (await adapter.listConversations()).filter(item => item.isDirect && item.participantIds.includes("bob"));
  assert.equal(direct.length, 1, "it must use one direct conversation, not open a second one");
  await client.stop();
});

test("a conversation the two already share is used instead of opening another", async () => {
  const { adapter, client } = await startClient();
  const existing = await client.conversations.open("bob");

  await client.verification.request("bob");

  const direct = (await adapter.listConversations()).filter(item => item.isDirect && item.participantIds.includes("bob"));
  assert.deepEqual(direct.map(item => item.id), [existing.id]);
  await client.stop();
});

test("verifying one of my own devices still names the device", async () => {
  const { client } = await startClient();

  const started = await client.verification.request("alice", "ALICE-2");

  assert.equal(started.otherDeviceId, "ALICE-2");
  await client.stop();
});
