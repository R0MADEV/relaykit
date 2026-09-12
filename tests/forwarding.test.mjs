import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const from = await client.conversations.create({ participantIds: ["bob"], title: "Origen" });
  const to = await client.conversations.create({ participantIds: ["carol"], title: "Destino" });
  return { adapter, client, from, to };
}

test("a message can be passed on to another conversation", async () => {
  const { client, from, to } = await startClient();
  const original = await client.messages.send(from.id, "esto le interesa a Carol");

  const forwarded = await client.messages.forward(original.id, to.id);

  assert.equal(forwarded.conversationId, to.id);
  assert.equal(forwarded.body, "esto le interesa a Carol");
  assert.notEqual(forwarded.id, original.id);
  const there = await client.messages.list(to.id);
  assert.equal(there.at(-1)?.body, "esto le interesa a Carol");
  await client.stop();
});

test("passing a message on leaves the original where it was", async () => {
  const { client, from, to } = await startClient();
  const original = await client.messages.send(from.id, "queda aqui tambien");

  await client.messages.forward(original.id, to.id);

  const here = await client.messages.list(from.id);
  assert.equal(here.filter(message => message.body === "queda aqui tambien").length, 1);
  await client.stop();
});

test("the formatting and the kind travel with the message", async () => {
  const { client, from, to } = await startClient();
  const original = await client.messages.send(from.id, "aviso", {
    formattedBody: "<strong>aviso</strong>",
    kind: "notice"
  });

  const forwarded = await client.messages.forward(original.id, to.id);

  assert.equal(forwarded.formattedBody, "<strong>aviso</strong>");
  assert.equal(forwarded.kind, "notice");
  await client.stop();
});

test("a file is passed on as a file, not as its name", async () => {
  const { client, from, to } = await startClient();
  const data = new Uint8Array([1, 2, 3, 4]);
  const original = await client.messages.sendFile(from.id, { name: "informe.pdf", mimeType: "application/pdf", data });

  const forwarded = await client.messages.forward(original.id, to.id);

  assert.equal(forwarded.attachment?.name, "informe.pdf");
  assert.equal(forwarded.attachment?.mimeType, "application/pdf");
  assert.notEqual(forwarded.attachment?.source, original.attachment?.source);
  assert.deepEqual(new Uint8Array(await client.media.download(forwarded.attachment)), data);
  await client.stop();
});

test("a place is passed on as a place", async () => {
  const { client, from, to } = await startClient();
  const original = await client.messages.sendLocation(from.id, { latitude: 43.263, longitude: -2.935, description: "Bilbao" });

  const forwarded = await client.messages.forward(original.id, to.id);

  assert.equal(forwarded.location?.description, "Bilbao");
  await client.stop();
});

test("a message that never existed cannot be passed on", async () => {
  const { client, to } = await startClient();

  await assert.rejects(client.messages.forward("no-existe", to.id), /does not exist/i);
  await client.stop();
});

test("a message nobody could read cannot be passed on", async () => {
  const { adapter, client, from, to } = await startClient();
  adapter.receiveMessage(from.id, "bob", "", { id: "secreto", undecryptable: true });

  await assert.rejects(client.messages.forward("secreto", to.id), /cannot be read/i);
  await client.stop();
});
