import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  return { adapter, client, conversation };
}

test("a message can carry formatted text alongside the plain one", async () => {
  const { client, conversation } = await startClient();

  const message = await client.messages.send(conversation.id, "hola en negrita", {
    formattedBody: "hola en <strong>negrita</strong>"
  });

  assert.equal(message.body, "hola en negrita");
  assert.equal(message.formattedBody, "hola en <strong>negrita</strong>");
  const listed = await client.messages.list(conversation.id);
  assert.equal(listed[0].formattedBody, "hola en <strong>negrita</strong>");
  await client.stop();
});

test("a message can name the people it is aimed at", async () => {
  const { client, conversation } = await startClient();

  const message = await client.messages.send(conversation.id, "bob, mira esto", {
    mentions: { userIds: ["bob"] }
  });

  assert.deepEqual(message.mentions?.userIds, ["bob"]);
  assert.equal(message.mentions?.everyone, undefined);
  await client.stop();
});

test("a message can be aimed at the whole conversation", async () => {
  const { client, conversation } = await startClient();

  const message = await client.messages.send(conversation.id, "atencion", { mentions: { everyone: true } });

  assert.equal(message.mentions?.everyone, true);
  await client.stop();
});

test("a message can be an action or a notice instead of plain talk", async () => {
  const { client, conversation } = await startClient();

  const action = await client.messages.send(conversation.id, "saluda", { kind: "action" });
  const notice = await client.messages.send(conversation.id, "despliegue terminado", { kind: "notice" });
  const plain = await client.messages.send(conversation.id, "hola");

  assert.equal(action.kind, "action");
  assert.equal(notice.kind, "notice");
  assert.equal(plain.kind, undefined);
  await client.stop();
});

test("formatted text and mentions are validated", async () => {
  const { client, conversation } = await startClient();

  await assert.rejects(
    client.messages.send(conversation.id, "vacio", { formattedBody: "   " }),
    { code: "INVALID_INPUT" }
  );
  await assert.rejects(
    client.messages.send(conversation.id, "malo", { mentions: { userIds: ["  "] } }),
    { code: "INVALID_INPUT" }
  );
  await client.stop();
});
