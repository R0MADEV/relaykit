import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token", deviceId: "ALICE-1" };
const image = { mimeType: "image/png", data: new Uint8Array([137, 80, 78, 71]) };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

test("a person can change their own display name", async () => {
  const { client } = await startClient();

  await client.users.setDisplayName("Alicia");

  assert.equal((await client.users.profile("alice")).displayName, "Alicia");
  await assert.rejects(client.users.setDisplayName("   "), { code: "INVALID_INPUT" });
  await client.stop();
});

test("a person can change their own avatar and read it back", async () => {
  const { client } = await startClient();

  await client.users.setAvatar(image);

  const profile = await client.users.profile("alice");
  assert.ok(profile.avatarId);
  const stored = await client.users.avatar("alice");
  assert.deepEqual(stored.data, image.data);
  assert.equal(stored.mimeType, "image/png");
  await client.stop();
});

test("the devices of the account are listed, with the current one marked", async () => {
  const { adapter, client } = await startClient();
  adapter.addDevice("ALICE-2", "Movil");

  const devices = await client.devices.list();

  assert.deepEqual(devices.map(device => device.id).sort(), ["ALICE-1", "ALICE-2"]);
  assert.equal(devices.find(device => device.id === "ALICE-1").isCurrent, true);
  assert.equal(devices.find(device => device.id === "ALICE-2").displayName, "Movil");
  await client.stop();
});

test("a device can be renamed and signed out", async () => {
  const { adapter, client } = await startClient();
  adapter.addDevice("ALICE-2", "Movil");

  await client.devices.rename("ALICE-2", "Movil de trabajo");
  assert.equal((await client.devices.list()).find(device => device.id === "ALICE-2").displayName, "Movil de trabajo");

  await client.devices.signOut(["ALICE-2"], { password: "secreta" });

  assert.deepEqual((await client.devices.list()).map(device => device.id), ["ALICE-1"]);
  await assert.rejects(client.devices.signOut([], { password: "secreta" }), { code: "INVALID_INPUT" });
  await client.stop();
});
