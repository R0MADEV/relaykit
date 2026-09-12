import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token", deviceId: "ALICE-1" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  return { adapter, client, conversation };
}

test("the key a conversation is locked with can be thrown away so the next one is new", async () => {
  const { adapter, client, conversation } = await startClient();

  await client.conversations.rotateKeys(conversation.id);

  assert.deepEqual(adapter.rotatedKeysOf(), [conversation.id]);
  await client.stop();
});

test("throwing away the key of a conversation that does not exist says so", async () => {
  const { client } = await startClient();

  await assert.rejects(client.conversations.rotateKeys("   "), /conversation/i);
  await client.stop();
});

test("a device that was trusted can stop being trusted", async () => {
  const { adapter, client } = await startClient();
  adapter.addDevice("alice", { id: "ALICE-2", displayName: "Portatil", isCurrent: false });
  await client.devices.verify("alice", "ALICE-2");

  await client.devices.revoke("alice", "ALICE-2");

  const status = await client.devices.verification("alice", "ALICE-2");
  assert.equal(status?.verified, false);
  await client.stop();
});

test("revoking needs to know which device, or it would say nothing", async () => {
  const { client } = await startClient();

  await assert.rejects(client.devices.revoke("alice", "  "), /device/i);
  await client.stop();
});
