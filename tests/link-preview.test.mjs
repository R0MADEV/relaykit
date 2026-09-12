import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/**
 * En un chat de trabajo la gente pega enlaces todo el dia. Sin previsualizacion se ve una URL cruda y nadie
 * sabe que hay detras sin abrirla. Quien la pide es el homeserver, no el navegador: asi no se filtra a quien
 * publique el enlace que alguien de esta organizacion lo esta mirando.
 */
async function startClient(adapter = new InMemoryAdapter()) {
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

test("un enlace se puede previsualizar antes de abrirlo", async () => {
  const { client } = await startClient();

  const preview = await client.media.preview("https://ejemplo.test/articulo");

  assert.equal(typeof preview.url, "string");
  assert.equal(preview.title, "Un articulo de ejemplo");
});

test("un enlace del que no se sabe nada no inventa nada", async () => {
  const { client } = await startClient();

  const preview = await client.media.preview("https://ejemplo.test/nada");

  assert.equal(preview.title, undefined);
  assert.equal(preview.description, undefined);
});

test("lo que no es un enlace se rechaza en vez de preguntarlo", async () => {
  const { client } = await startClient();

  await assert.rejects(client.media.preview("   "), { code: "INVALID_INPUT" });
  await assert.rejects(client.media.preview("esto no es una direccion"), { code: "INVALID_INPUT" });
});

test("el mismo enlace dos veces se pregunta una vez", async () => {
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
