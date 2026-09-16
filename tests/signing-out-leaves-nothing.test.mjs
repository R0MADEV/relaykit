import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { IndexedDbStorage } from "@relaykit/browser-storage";
import { StoreForWhoeverIsSignedIn, createBrowserStoreName } from "../packages/web/dist/index.js";

const alice = { homeserver: "memory://test", userId: "@alice:localhost", accessToken: "t" };

function whatIsThere() {
  return indexedDB.databases().then(all => all.map(each => each.name));
}

/**
 * Signing out empties the local copy, which is not the same as taking it away: the database stayed, with its
 * six empty stores, next to the two the session had already taken with it. Three things go in, and only one
 * of them was left behind — which is exactly what it looked like from the browser's storage panel.
 */
test("signing out takes the local copy away, not only what was in it", async () => {
  const name = createBrowserStoreName(undefined, alice.userId);
  const store = new StoreForWhoeverIsSignedIn(session =>
    session ? new IndexedDbStorage(name, { encryptionSecret: "secreto" }) : undefined
  );
  store.nowSignedInAs(alice);
  await store.saveConversation({ id: "!una:localhost", participantIds: [alice.userId] });
  assert.ok((await whatIsThere()).includes(name), "it was never opened");

  await store.nowSignedInAs(undefined);

  assert.ok(!(await whatIsThere()).includes(name), `the local copy is still there: ${await whatIsThere()}`);
});

test("but a different person signing in leaves the first one's copy alone", async () => {
  const hers = createBrowserStoreName(undefined, alice.userId);
  const his = createBrowserStoreName(undefined, "@bob:localhost");
  const store = new StoreForWhoeverIsSignedIn(session =>
    session
      ? new IndexedDbStorage(createBrowserStoreName(undefined, session.userId), {
          encryptionSecret: "secreto"
        })
      : undefined
  );
  store.nowSignedInAs(alice);
  await store.saveConversation({ id: "!otra:localhost", participantIds: [alice.userId] });

  await store.nowSignedInAs({ ...alice, userId: "@bob:localhost" });
  await store.getConversations();

  // Hers is not gone: she did not sign out, somebody else signed in. What she wrote is waiting for her.
  const there = await whatIsThere();
  assert.ok(there.includes(hers), "somebody else signing in took her copy away");
  assert.ok(there.includes(his));
});
