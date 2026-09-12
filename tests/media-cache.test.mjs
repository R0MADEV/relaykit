import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

class CountingAdapter extends InMemoryAdapter {
  downloads = 0;

  async downloadAttachment(media) {
    this.downloads += 1;
    return super.downloadAttachment(media);
  }
}

async function startClient(cache) {
  const adapter = new CountingAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session, ...cache && { cache } });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  return { adapter, client, conversation };
}

function file(name, bytes) {
  return { name, mimeType: "application/octet-stream", data: new Uint8Array(bytes) };
}

test("the same attachment is only fetched once", async () => {
  const { adapter, client, conversation } = await startClient();
  const sent = await client.messages.sendFile(conversation.id, file("uno.bin", [1, 2, 3, 4]));

  const first = await client.media.download(sent.attachment);
  const second = await client.media.download(sent.attachment);

  assert.deepEqual(new Uint8Array(second), new Uint8Array(first));
  assert.equal(adapter.downloads, 1);
  await client.stop();
});

test("what comes back from the cache is not the copy the caller can change", async () => {
  const { client, conversation } = await startClient();
  const sent = await client.messages.sendFile(conversation.id, file("uno.bin", [1, 2, 3, 4]));
  const first = await client.media.download(sent.attachment);

  first[0] = 99;

  const second = await client.media.download(sent.attachment);
  assert.equal(second[0], 1);
  await client.stop();
});

test("two different attachments are both fetched", async () => {
  const { adapter, client, conversation } = await startClient();
  const one = await client.messages.sendFile(conversation.id, file("uno.bin", [1, 2, 3, 4]));
  const two = await client.messages.sendFile(conversation.id, file("dos.bin", [5, 6, 7, 8]));

  await client.media.download(one.attachment);
  await client.media.download(two.attachment);

  assert.equal(adapter.downloads, 2);
  await client.stop();
});

test("the cache does not grow without limit: the oldest is dropped and fetched again", async () => {
  const { adapter, client, conversation } = await startClient({ downloadedBytes: 8 });
  const one = await client.messages.sendFile(conversation.id, file("uno.bin", [1, 2, 3, 4]));
  const two = await client.messages.sendFile(conversation.id, file("dos.bin", [5, 6, 7, 8]));
  const three = await client.messages.sendFile(conversation.id, file("tres.bin", [9, 10, 11, 12]));

  await client.media.download(one.attachment);
  await client.media.download(two.attachment);
  await client.media.download(three.attachment);
  await client.media.download(one.attachment);

  assert.equal(adapter.downloads, 4);
  await client.stop();
});

test("with the cache turned off everything is fetched again", async () => {
  const { adapter, client, conversation } = await startClient({ downloadedBytes: 0 });
  const sent = await client.messages.sendFile(conversation.id, file("uno.bin", [1, 2, 3, 4]));

  await client.media.download(sent.attachment);
  await client.media.download(sent.attachment);

  assert.equal(adapter.downloads, 2);
  await client.stop();
});

test("an attachment bigger than the whole cache is still delivered, just not kept", async () => {
  const { adapter, client, conversation } = await startClient({ downloadedBytes: 2 });
  const sent = await client.messages.sendFile(conversation.id, file("grande.bin", [1, 2, 3, 4]));

  const bytes = await client.media.download(sent.attachment);
  await client.media.download(sent.attachment);

  assert.deepEqual(new Uint8Array(bytes), new Uint8Array([1, 2, 3, 4]));
  assert.equal(adapter.downloads, 2);
  await client.stop();
});

test("signing out leaves no downloaded files behind in memory", async () => {
  const { adapter, client, conversation } = await startClient();
  const sent = await client.messages.sendFile(conversation.id, file("uno.bin", [1, 2, 3, 4]));
  await client.media.download(sent.attachment);

  await client.logout();
  await client.login({ homeserver: "memory://test", username: "alice", password: "x" });
  await client.start();
  await client.media.download(sent.attachment).catch(() => undefined);

  assert.equal(adapter.downloads, 2);
  await client.stop();
});
