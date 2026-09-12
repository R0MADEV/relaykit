import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };
const pegatina = {
  data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
  mimeType: "image/png",
  name: "saludo",
  width: 128,
  height: 128
};

/**
 * Una pegatina no es un adjunto: se pinta sola, sin nombre de fichero ni boton de descarga, y quien la recibe
 * tiene que poder distinguirla para pintarla asi. En Matrix es un evento propio, `m.sticker`.
 */
async function startClient() {
  const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "pegatinas" });
  return { client, conversation };
}

test("una pegatina se envia y llega como pegatina, no como adjunto", async () => {
  const { client, conversation } = await startClient();

  const sent = await client.messages.sendSticker(conversation.id, pegatina);

  assert.equal(sent.kind, "sticker");
  assert.equal(sent.attachment.mimeType, "image/png");
  assert.equal(sent.attachment.width, 128);
  assert.equal(sent.body, "saludo");
});

test("una pegatina se lee del historial como pegatina", async () => {
  const { client, conversation } = await startClient();
  await client.messages.sendSticker(conversation.id, pegatina);

  const [leida] = await client.messages.list(conversation.id);

  assert.equal(leida.kind, "sticker");
  assert.ok(leida.attachment);
});

test("una pegatina sin imagen no es una pegatina", async () => {
  const { client, conversation } = await startClient();

  await assert.rejects(
    client.messages.sendSticker(conversation.id, { ...pegatina, data: new Uint8Array() }),
    { code: "INVALID_INPUT" }
  );
  await assert.rejects(
    client.messages.sendSticker(conversation.id, { ...pegatina, mimeType: "  " }),
    { code: "INVALID_INPUT" }
  );
});
