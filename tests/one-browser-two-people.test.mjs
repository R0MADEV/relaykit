import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { IndexedDbStorage } from "@relaykit/browser-storage";
import { createBrowserStoreName } from "../packages/web/dist/index.js";

/**
 * One browser, two people, one after the other.
 *
 * The other tests here prove which copy gets opened. This one proves what that is for: what the first person
 * wrote is not reachable by the second, with a real IndexedDB in between rather than a note of which name was
 * asked for. Both are needed — the wiring can be right while the isolation is not, and the day the naming
 * changes this is the test that says so.
 */
const alice = "@alice:localhost";
const bob = "@bob:localhost";
// The same one for both on purpose: this browser has one device secret, so isolation cannot be resting on the
// key being different. It has to rest on them being different copies.
const deviceSecret = "el-mismo-secreto-de-este-navegador";

function copyFor(userId) {
  return new IndexedDbStorage(createBrowserStoreName(undefined, userId), {
    encryptionSecret: deviceSecret
  });
}

test("what one person wrote is not there for the next person on the same browser", async () => {
  const hers = copyFor(alice);
  await hers.saveConversation({ id: "!suya:localhost", participantIds: [alice, bob] });
  await hers.saveMessage({
    id: "$suyo",
    conversationId: "!suya:localhost",
    senderId: alice,
    body: "algo que solo es de alice",
    createdAt: 1,
    status: "sent"
  });
  await hers.saveDraft("!suya:localhost", "un borrador a medio escribir");
  await hers.close();

  const his = copyFor(bob);

  assert.deepEqual(await his.getConversations(), []);
  assert.deepEqual(await his.getMessages("!suya:localhost"), []);
  assert.equal(await his.getMessage("$suyo"), undefined);
  assert.equal(await his.getDraft("!suya:localhost"), undefined);
  await his.close();
});

test("and hers is still hers when she comes back", async () => {
  const back = copyFor(alice);

  const conversations = await back.getConversations();
  assert.deepEqual(
    conversations.map(each => each.id),
    ["!suya:localhost"]
  );
  assert.equal((await back.getMessage("$suyo"))?.body, "algo que solo es de alice");
  assert.equal(await back.getDraft("!suya:localhost"), "un borrador a medio escribir");
  await back.close();
});
