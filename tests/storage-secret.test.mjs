import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { IndexedDbStorage } from "@relaykit/browser-storage";

const conversation = { id: "!room:localhost", title: "a room", participantIds: ["@alice:localhost"] };
const message = {
  id: "$uno", conversationId: "!room:localhost", senderId: "@alice:localhost",
  body: "lo que dije ayer", sentAt: 1, status: "sent"
};

/**
 * The secret that encrypts the local copy decides whether it survives signing in again. Using something that
 * changes on every sign in, such as the access token, leaves yesterday's copy unreadable, and unreadable
 * records are dropped without a word: the screen simply comes back empty.
 */
test("what was kept is still there when the secret is the same", async () => {
  const before = new IndexedDbStorage("same-key", { encryptionSecret: "un secreto estable" });
  await before.saveConversation(conversation);
  await before.saveMessages([message]);

  const after = new IndexedDbStorage("same-key", { encryptionSecret: "un secreto estable" });

  assert.equal((await after.getConversations()).length, 1);
  assert.equal((await after.getMessages("!room:localhost"))[0].body, "lo que dije ayer");
});

test("a secret that changed between sign ins loses the local copy without saying so", async () => {
  const before = new IndexedDbStorage("changed-key", { encryptionSecret: "el token de ayer" });
  await before.saveConversation(conversation);
  await before.saveMessages([message]);

  const after = new IndexedDbStorage("changed-key", { encryptionSecret: "el token de hoy" });
  const messages = await after.getMessages("!room:localhost");

  // Why the default secret belongs to the device and not to the session: anything that changes between sign
  // ins throws the local copy away, and nothing says it happened.
  assert.equal(messages.length, 0);
});
