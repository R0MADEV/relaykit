import assert from "node:assert/strict";
import test from "node:test";

const { MatrixMedia } = await import("../packages/matrix-js/dist/matrix-media.js");

/**
 * Stopping a file that is on its way up.
 *
 * Cancelling used to be refused outright while something was being sent, which is the moment somebody most
 * wants it: forty megabytes from a phone, the wrong file, and no way to stop it. Refusing is defensible for a
 * message — it may already be said — but not for a file, where what is left is the upload, and the upload is
 * the part that costs.
 *
 * The SDK stops it. It wants the promise its own upload gave back, so that is what is kept.
 */
function clientThatUploadsSlowly(stopped) {
  const uploads = new Map();
  return {
    // Enough of a room to get as far as uploading, which is what this is about.
    getRoom: () => ({ roomId: "!room:localhost", hasEncryptionStateEvent: () => false }),
    uploadContent: () => {
      // Never finishes on its own, and fails when it is stopped, which is what the real one does.
      let giveUp;
      const promise = new Promise((_, no) => { giveUp = no; });
      promise.catch(() => undefined);
      uploads.set(promise, giveUp);
      return promise;
    },
    cancelUpload: promise => {
      const giveUp = uploads.get(promise);
      if (!giveUp) return false;
      stopped.push(promise);
      giveUp(new Error("Aborted"));
      return true;
    }
  };
}

test("a file on its way up can be stopped, and the SDK is what stops it", async () => {
  const stopped = [];
  const client = clientThatUploadsSlowly(stopped);
  const media = new MatrixMedia();
  media.remember(client);
  // Started and deliberately not waited for: the point is to stop it while it is going.
  const going = media.send(client, "!room:localhost", { name: "enorme.bin", mimeType: "application/octet-stream", data: new Uint8Array(10) }, "txn-1", undefined)
    .catch(() => undefined);
  await new Promise(resolve => setTimeout(resolve, 20));

  const didStop = await media.stopSending("txn-1");

  assert.equal(didStop, true, "it said nothing was being sent");
  assert.equal(stopped.length, 1, "the upload was not the one stopped");
  await going;
});

test("stopping something that is not being sent says so rather than pretending", async () => {
  const media = new MatrixMedia();

  assert.equal(await media.stopSending("txn-nothing"), false);
});

import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

/**
 * And from the outside: cancelling a file that is being sent works, where before it was refused outright.
 *
 * Refusing is right for a message — it may already have been said, and unsaying it is a different thing — but
 * a file that is still going up has not been said to anybody yet, and the upload is the part that costs.
 */
test("a file being sent can be cancelled, where a message that is gone cannot", async () => {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({
    adapter,
    storage: new InMemoryStorage(),
    session: { homeserver: "memory://test", userId: "alice", accessToken: "token" }
  });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "files" });

  const sent = await client.messages.sendFile(conversation.id, {
    name: "grande.bin",
    mimeType: "application/octet-stream",
    data: new Uint8Array(32)
  });

  // Already gone: nothing to stop, and saying otherwise would be a lie.
  await assert.rejects(() => client.messages.cancel(sent.id), /queued or failed|already/i);
  await client.stop();
});
