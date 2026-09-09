import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };
const bytes = new Uint8Array([1, 2, 3, 4, 5]);
const file = { name: "notes.txt", mimeType: "text/plain", data: bytes };

class FailingOnceAdapter extends InMemoryAdapter {
  failuresLeft = 0;

  async sendAttachment(conversationId, upload, transactionId, onProgress) {
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error("upload failed");
    }
    return super.sendAttachment(conversationId, upload, transactionId, onProgress);
  }
}

async function startClient(adapter = new InMemoryAdapter(), storage = new InMemoryStorage()) {
  const client = new MessagingClient({ adapter, storage, session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  return { adapter, storage, client, conversation };
}

test("sendFile delivers a message with attachment metadata that can be downloaded", async () => {
  const { client, conversation } = await startClient();
  const progress = [];

  const message = await client.messages.sendFile(conversation.id, file, { onProgress: value => progress.push(value) });

  assert.equal(message.status, "sent");
  assert.equal(message.body, "notes.txt");
  assert.equal(message.attachment.name, "notes.txt");
  assert.equal(message.attachment.mimeType, "text/plain");
  assert.equal(message.attachment.size, 5);
  assert.deepEqual(progress.at(-1), 1);
  const listed = await client.messages.list(conversation.id);
  assert.equal(listed[0].attachment.name, "notes.txt");
  assert.deepEqual(await client.media.download(message.attachment), bytes);
  await client.stop();
});

test("a failed file send is persisted in the outbox and recovered after a restart", async () => {
  const adapter = new FailingOnceAdapter();
  const storage = new InMemoryStorage();
  const first = await startClient(adapter, storage);
  adapter.failuresLeft = 1;
  await assert.rejects(first.client.messages.sendFile(first.conversation.id, file));
  const failed = (await first.client.messages.list(first.conversation.id)).find(item => item.body === "notes.txt");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.attachment?.name, "notes.txt");
  await first.client.stop();
  const operation = await storage.getOutboxOperation(failed.id);
  assert.deepEqual(operation.attachment.data, bytes);
  await storage.saveOutboxOperation({ ...operation, nextAttemptAt: 0 });

  const second = new MessagingClient({ adapter, storage, session });
  await second.start();
  const messages = await second.messages.list(first.conversation.id);
  const sent = messages.find(item => item.body === "notes.txt");

  assert.equal(sent?.status, "sent");
  assert.deepEqual(await second.media.download(sent.attachment), bytes);
  assert.equal(await storage.getOutboxOperation(failed.id), undefined);
  await second.stop();
});

test("sendFile validates the file input", async () => {
  const { client, conversation } = await startClient();

  await assert.rejects(client.messages.sendFile(conversation.id, { ...file, name: " " }), { code: "INVALID_INPUT" });
  await assert.rejects(client.messages.sendFile(conversation.id, { ...file, mimeType: "" }), { code: "INVALID_INPUT" });
  await assert.rejects(client.messages.sendFile(conversation.id, { ...file, data: new Uint8Array() }), { code: "INVALID_INPUT" });
  await client.stop();
});

test("download rejects an unknown attachment", async () => {
  const { client } = await startClient();

  await assert.rejects(client.media.download({ id: "missing", name: "x", mimeType: "text/plain", source: "missing" }), { code: "ADAPTER_ERROR" });
  await client.stop();
});

const thumbnailBytes = new Uint8Array([9, 8, 7]);

test("a file can carry a thumbnail that is downloaded on its own", async () => {
  const { client, conversation } = await startClient();

  const message = await client.messages.sendFile(conversation.id, {
    ...file,
    name: "foto.jpg",
    mimeType: "image/jpeg",
    width: 1600,
    height: 1200,
    thumbnail: { mimeType: "image/jpeg", data: thumbnailBytes, width: 160, height: 120 }
  });

  const { thumbnail } = message.attachment;
  assert.equal(thumbnail.mimeType, "image/jpeg");
  assert.equal(thumbnail.width, 160);
  assert.notEqual(thumbnail.source, message.attachment.source);
  assert.deepEqual(await client.media.download(thumbnail), thumbnailBytes);
  assert.deepEqual(await client.media.download(message.attachment), bytes);
  await client.stop();
});

test("a file without a thumbnail has none", async () => {
  const { client, conversation } = await startClient();

  const message = await client.messages.sendFile(conversation.id, file);

  assert.equal(message.attachment.thumbnail, undefined);
  await client.stop();
});
