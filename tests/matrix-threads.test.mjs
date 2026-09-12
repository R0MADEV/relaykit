import assert from "node:assert/strict";
import test from "node:test";

const { listMatrixThreads } = await import("../packages/matrix-js/dist/matrix-details.js");

/**
 * Listing the threads of a conversation is one request the SDK knows how to make. Nothing here builds a URL,
 * picks a prefix or writes an Authorization header: it asks the SDK and reads what comes back.
 */
function fakeClient(asked, chunk) {
  const room = {
    roomId: "!sala:localhost",
    findEventById: () => undefined,
    getThread: () => undefined,
    getThreadUnreadNotificationCount: () => 0
  };
  return {
    getRoom: () => room,
    getSafeUserId: () => "@alice:localhost",
    createThreadListMessagesRequest: async (roomId, fromToken, limit, dir, filterType) => {
      asked.push({ roomId, fromToken, limit, dir, filterType });
      return { chunk };
    }
  };
}

const aThreadRoot = {
  event_id: "$raiz",
  unsigned: { "m.relations": { "m.thread": { count: 3, latest_event: { event_id: "$ultima" } } } }
};

test("the threads of a conversation are asked for through the SDK, in one request", async () => {
  const asked = [];

  const threads = await listMatrixThreads(fakeClient(asked, [aThreadRoot]), "!sala:localhost");

  assert.equal(asked.length, 1);
  assert.equal(asked[0].roomId, "!sala:localhost");
  assert.equal(asked[0].fromToken, null);
  assert.ok(asked[0].limit >= 1);
  assert.deepEqual(threads, [{
    conversationId: "!sala:localhost",
    rootId: "$raiz",
    replyCount: 3,
    unreadCount: 0
  }]);
});

test("a conversation with nothing hanging off it comes back empty, not broken", async () => {
  const threads = await listMatrixThreads(fakeClient([], []), "!sala:localhost");

  assert.deepEqual(threads, []);
});

test("a root the homeserver says nothing about is still listed, with nothing made up", async () => {
  const threads = await listMatrixThreads(fakeClient([], [{ event_id: "$sola" }]), "!sala:localhost");

  assert.equal(threads[0].rootId, "$sola");
  assert.equal(threads[0].replyCount, 0);
  assert.equal(threads[0].lastMessage, undefined);
});
