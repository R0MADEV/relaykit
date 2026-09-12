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
  // What fits in a short string: the colours of the image, blurred. Painted while the real one arrives.
  blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj"
};

async function startClient() {
  const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "fotos" });
  return { client, conversation };
}

test("an image can carry its blur, to paint something while it arrives", async () => {
  const { client, conversation } = await startClient();

  const sent = await client.messages.sendFile(conversation.id, imagen);

  assert.equal(sent.attachment.blurhash, "LEHV6nWB2yk8pyo0adR*.7kCMdnj");
});

test("the blur is still there when reading the history, which is when it is needed", async () => {
  const { client, conversation } = await startClient();
  await client.messages.sendFile(conversation.id, imagen);

  const [leida] = await client.messages.list(conversation.id);

  assert.equal(leida.attachment.blurhash, "LEHV6nWB2yk8pyo0adR*.7kCMdnj");
});

test("an image with no blur does not make one up", async () => {
  const { client, conversation } = await startClient();
  const { blurhash: _sin, ...sinBorron } = imagen;

  const sent = await client.messages.sendFile(conversation.id, sinBorron);

  assert.equal(sent.attachment.blurhash, undefined);
});
