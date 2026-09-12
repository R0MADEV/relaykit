import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };
const file = { name: "informe.pdf", mimeType: "application/pdf", data: new Uint8Array([1, 2, 3, 4]) };

class FailingAdapter extends InMemoryAdapter {
  failUploads = false;

  async sendAttachment(...args) {
    if (this.failUploads) throw new Error("the homeserver is not answering");
    return super.sendAttachment(...args);
  }
}

async function startClient(withStorage) {
  const adapter = new FailingAdapter();
  const client = new MessagingClient({
    adapter,
    session,
    ...(withStorage ? { storage: new InMemoryStorage() } : {})
  });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  return { adapter, client, conversation };
}

test("a file that did not go out can be sent again once the homeserver answers", async () => {
  const { adapter, client, conversation } = await startClient(true);
  adapter.failUploads = true;
  const queued = await client.messages.sendFile(conversation.id, file).catch(error => error);
  assert.ok(queued instanceof Error);

  adapter.failUploads = false;
  const waiting = (await client.messages.list(conversation.id)).find(message => message.body === file.name);
  const sent = await client.messages.retry(waiting.id);

  assert.equal(sent.status, "sent");
  assert.equal(sent.attachment?.name, file.name);
  await client.stop();
});

test("the file comes back whole after being sent again", async () => {
  const { adapter, client, conversation } = await startClient(true);
  adapter.failUploads = true;
  await client.messages.sendFile(conversation.id, file).catch(() => undefined);
  adapter.failUploads = false;
  const waiting = (await client.messages.list(conversation.id)).find(message => message.body === file.name);

  const sent = await client.messages.retry(waiting.id);

  assert.deepEqual(new Uint8Array(await client.media.download(sent.attachment)), file.data);
  await client.stop();
});

test("without anywhere to keep it, a file that did not go out says so plainly", async () => {
  const { adapter, client, conversation } = await startClient(false);
  adapter.failUploads = true;
  const queued = await client.messages.sendFile(conversation.id, file).catch(error => error);

  assert.ok(queued instanceof Error);
  assert.match(queued.message, /no longer available|not be sent/i);
  await client.stop();
});
