import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };
const imagen = {
  data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
  mimeType: "image/png",
  name: "foto.png",
  width: 800,
  height: 600,
  // Lo que cabe en una cadena corta: los colores de la imagen, borrosos. Se pinta mientras llega la de verdad.
  blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj"
};

async function startClient() {
  const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "fotos" });
  return { client, conversation };
}

test("una imagen puede llevar su borrón, para pintar algo mientras llega", async () => {
  const { client, conversation } = await startClient();

  const sent = await client.messages.sendFile(conversation.id, imagen);

  assert.equal(sent.attachment.blurhash, "LEHV6nWB2yk8pyo0adR*.7kCMdnj");
});

test("el borrón sigue ahí al leer el historial, que es cuando hace falta", async () => {
  const { client, conversation } = await startClient();
  await client.messages.sendFile(conversation.id, imagen);

  const [leida] = await client.messages.list(conversation.id);

  assert.equal(leida.attachment.blurhash, "LEHV6nWB2yk8pyo0adR*.7kCMdnj");
});

test("una imagen sin borrón no se inventa ninguno", async () => {
  const { client, conversation } = await startClient();
  const { blurhash: _sin, ...sinBorron } = imagen;

  const sent = await client.messages.sendFile(conversation.id, sinBorron);

  assert.equal(sent.attachment.blurhash, undefined);
});
