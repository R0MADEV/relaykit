import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = {
  homeserver: "memory://test",
  userId: "alice",
  accessToken: "token",
  deviceId: "this one"
};

async function startWith(devices) {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, session });
  await client.start();
  for (const [id, lastSeenAt] of devices) adapter.addDevice(id, undefined, lastSeenAt);
  return client;
}

test("the device being used comes first, whenever it was last seen", async () => {
  const client = await startWith([
    ["old", 3000],
    ["recent", 5000]
  ]);

  assert.deepEqual(
    (await client.devices.list()).map(device => device.id),
    ["this one", "recent", "old"]
  );
  await client.stop();
});

test("a device nobody has heard from goes last, not first", async () => {
  const client = await startWith([
    ["silent", undefined],
    ["recent", 5000]
  ]);

  assert.deepEqual(
    (await client.devices.list()).map(device => device.id),
    ["this one", "recent", "silent"]
  );
  await client.stop();
});
