import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/**
 * In a work chat people paste links all day. Without a preview all you see is a raw URL and nobody knows what
 * is behind it without opening it. The homeserver asks, not the browser: that way whoever publishes the link
 * is not told that somebody from this organisation is looking at it.
 */
async function startClient(adapter = new InMemoryAdapter()) {
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

test("a link can be previewed before opening it", async () => {
  const { client } = await startClient();

  const preview = await client.media.preview("https://ejemplo.test/articulo");

  assert.equal(typeof preview.url, "string");
  assert.equal(preview.title, "Un articulo de ejemplo");
});

test("a link nothing is known about makes nothing up", async () => {
  const { client } = await startClient();

  const preview = await client.media.preview("https://ejemplo.test/nada");

  assert.equal(preview.title, undefined);
  assert.equal(preview.description, undefined);
});

test("what is not a link is refused rather than asked about", async () => {
  const { client } = await startClient();

  await assert.rejects(client.media.preview("   "), { code: "INVALID_INPUT" });
  await assert.rejects(client.media.preview("esto no es una direccion"), { code: "INVALID_INPUT" });
});

test("the same link twice is asked about once", async () => {
  class CountingAdapter extends InMemoryAdapter {
    asked = 0;
    async previewLink(url) {
      this.asked += 1;
      return super.previewLink(url);
    }
  }
  const { adapter, client } = await startClient(new CountingAdapter());

  await client.media.preview("https://ejemplo.test/articulo");
  await client.media.preview("https://ejemplo.test/articulo");

  assert.equal(adapter.asked, 1);
});
