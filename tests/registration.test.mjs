import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const credentials = { homeserver: "memory://test", username: "nueva", password: "contraseña-larga" };

function createClient(adapter = new InMemoryAdapter()) {
  return { adapter, client: new MessagingClient({ adapter, storage: new InMemoryStorage() }) };
}

test("registering leaves the client with a usable session", async () => {
  const { client } = createClient();

  const session = await client.register(credentials);
  await client.start();

  assert.equal(session.userId, "nueva");
  assert.ok(session.accessToken.length > 0);
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  assert.ok(conversation.id.length > 0);
  await client.stop();
});

test("registering validates what it is given", async () => {
  const { client } = createClient();

  await assert.rejects(client.register({ ...credentials, username: "  " }), { code: "INVALID_INPUT" });
  await assert.rejects(client.register({ ...credentials, password: "" }), { code: "INVALID_INPUT" });
});

test("a taken username is reported as such and not as a generic failure", async () => {
  const { adapter, client } = createClient();
  adapter.takeUsername("nueva");

  await assert.rejects(client.register(credentials), { code: "USERNAME_TAKEN" });
});

test("a homeserver that asks for more than a password says so", async () => {
  const { adapter, client } = createClient();
  adapter.requireRegistrationStages(["m.login.recaptcha", "m.login.terms"]);

  await assert.rejects(
    client.register(credentials),
    error => error.code === "REGISTRATION_UNSUPPORTED" && /recaptcha/.test(error.message) && /terms/.test(error.message)
  );
});
