import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token", deviceId: "ALICE-1" };

const registration = {
  gatewayUrl: "https://push.example.com/_matrix/push/v1/notify",
  deviceToken: "https://fcm.example.com/endpoint/alice-laptop",
  appId: "com.example.chat.web",
  appName: "Ejemplo",
  deviceName: "Portatil"
};

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

test("a device can ask the homeserver to notify it while the application is closed", async () => {
  const { client } = await startClient();

  await client.push.register(registration);

  const registered = await client.push.registered();
  assert.equal(registered.length, 1);
  assert.equal(registered[0].deviceToken, registration.deviceToken);
  assert.equal(registered[0].gatewayUrl, registration.gatewayUrl);
  assert.equal(registered[0].appName, "Ejemplo");
  await client.stop();
});

test("registering the same device twice replaces what the homeserver had", async () => {
  const { client } = await startClient();

  await client.push.register(registration);
  await client.push.register({ ...registration, deviceName: "Portatil del trabajo" });

  const registered = await client.push.registered();
  assert.equal(registered.length, 1);
  assert.equal(registered[0].deviceName, "Portatil del trabajo");
  await client.stop();
});

test("a device that stops wanting notifications is forgotten", async () => {
  const { client } = await startClient();
  await client.push.register(registration);

  await client.push.unregister(registration.deviceToken);

  assert.deepEqual(await client.push.registered(), []);
  await client.stop();
});

test("extra data the push gateway needs travels with the registration", async () => {
  const { client } = await startClient();

  await client.push.register({ ...registration, data: { public_key: "BN...", auth_secret: "abc" } });

  const registered = await client.push.registered();
  assert.equal(registered[0].data?.public_key, "BN...");
  await client.stop();
});

test("a registration without a gateway or a device token is refused before reaching the server", async () => {
  const { adapter, client } = await startClient();
  let asked = 0;
  const original = adapter.registerPush.bind(adapter);
  adapter.registerPush = (...args) => {
    asked += 1;
    return original(...args);
  };

  await assert.rejects(client.push.register({ ...registration, gatewayUrl: "  " }), /gateway/i);
  await assert.rejects(client.push.register({ ...registration, deviceToken: "" }), /device/i);

  assert.equal(asked, 0);
  await client.stop();
});
