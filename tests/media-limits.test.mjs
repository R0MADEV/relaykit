import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

/**
 * What the homeserver will take, asked before spending ten minutes sending something it will refuse.
 *
 * Every homeserver has a limit and says what it is. Not asking means the only way to find out is to upload a
 * file over a phone connection and be told no at the end, which is the worst possible moment.
 */
async function started() {
  const client = new MessagingClient({
    adapter: new InMemoryAdapter(),
    storage: new InMemoryStorage(),
    session: { homeserver: "memory://test", userId: "alice", accessToken: "token" }
  });
  await client.start();
  return client;
}

test("the homeserver is asked what it will take", async () => {
  const client = await started();

  const limits = await client.media.limits();

  assert.equal(typeof limits.maxUploadBytes, "number");
  assert.ok(limits.maxUploadBytes > 0);
  await client.stop();
});

test("something too big is refused here rather than after sending it", async () => {
  const client = await started();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "big" });
  const limits = await client.media.limits();
  const tooBig = {
    name: "enorme.bin",
    mimeType: "application/octet-stream",
    data: new Uint8Array(limits.maxUploadBytes + 1)
  };

  await assert.rejects(
    () => client.messages.sendFile(conversation.id, tooBig),
    error => {
      assert.equal(error.code, "INVALID_INPUT", `came back as ${error.code}`);
      assert.match(error.message, /takes files up to/i);
      return true;
    }
  );
  await client.stop();
});
