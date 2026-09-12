import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

/**
 * Transferring a call has two sides, and the SDK only does one of them: it tells the other party to ring
 * somebody else, and hangs up. Nothing in the SDK acts on that message when it arrives.
 *
 * So without this, transferring does nothing at all: one side hangs up believing it passed the call on, and
 * the other is simply cut off. Whoever is transferred to is never rung, because nobody was ever told.
 */
test("being asked to pass a call on is told to whoever is drawing the screen", async () => {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({
    adapter,
    storage: new InMemoryStorage(),
    session: { homeserver: "memory://test", userId: "alice", accessToken: "token" }
  });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "transfer" });

  const told = [];
  client.on("call.transferred", transfer => told.push(transfer));

  adapter.receiveTransfer(conversation.id, "carol");

  assert.equal(told.length, 1, "nobody was told the call was being passed on");
  assert.equal(told[0].conversationId, conversation.id);
  assert.equal(told[0].toUserId, "carol");
  await client.stop();
});

const { mapTransfer } = await import("../packages/matrix-js/dist/matrix-handlers.js");

/**
 * A transfer that already happened must not ring anybody. These arrive again whenever a client catches up —
 * replaying sync from storage, or coming back after being away — and acting on an old one rings somebody out
 * of nowhere about a call that ended long ago.
 *
 * The SDK has the same rule for incoming calls, and for the same reason.
 */
function transferEvent(ageInMilliseconds) {
  return {
    getType: () => "m.call.replaces",
    getLocalAge: () => ageInMilliseconds,
    getContent: () => ({ call_id: "call-1", target_user: { id: "@carol:localhost", display_name: "Carol" } })
  };
}

test("a transfer that just arrived is passed on", () => {
  const passed = mapTransfer(transferEvent(200), { roomId: "!room:localhost" }, { caughtUp: true });

  assert.equal(passed?.toUserId, "@carol:localhost");
  assert.equal(passed?.toDisplayName, "Carol");
});

test("a transfer from a while ago rings nobody", () => {
  assert.equal(
    mapTransfer(transferEvent(5 * 60 * 1000), { roomId: "!room:localhost" }, { caughtUp: true }),
    undefined
  );
});

test("anything that is not a transfer is left alone", () => {
  const other = { getType: () => "m.room.message", getLocalAge: () => 0, getContent: () => ({}) };

  assert.equal(mapTransfer(other, { roomId: "!room:localhost" }, { caughtUp: true }), undefined);
});

/**
 * A call handed to somebody already on the line reaches both of them, and says different things: one is told
 * to ring, the other to expect a ring. Reading both the same way has one of them ringing somebody who is
 * about to ring them, and neither of them being answered.
 */
test("being told to expect a call is not the same as being told to make one", () => {
  const expecting = {
    getType: () => "m.call.replaces",
    getLocalAge: () => 100,
    getContent: () => ({ call_id: "call-1", await_call: "call-9", target_user: { id: "@carol:localhost" } })
  };
  const ringing = {
    getType: () => "m.call.replaces",
    getLocalAge: () => 100,
    getContent: () => ({ call_id: "call-1", create_call: "call-9", target_user: { id: "@carol:localhost" } })
  };

  assert.equal(mapTransfer(expecting, { roomId: "!room:localhost" }, { caughtUp: true })?.waitForThem, true);
  assert.equal(mapTransfer(ringing, { roomId: "!room:localhost" }, { caughtUp: true })?.waitForThem, false);
});

/**
 * A transfer that arrives while the client is still catching up rings nobody.
 *
 * Signing in replays what was said while you were away, and a client that acts on every transfer it reads
 * there rings somebody about a call that finished before it even started. Being recent is not enough: a
 * transfer from a minute ago is recent and still over. What matters is that it is arriving now, live, rather
 * than being read out of the past.
 *
 * The SDK holds incoming calls back until the first sync is done, for exactly this reason.
 */
test("a transfer read while catching up rings nobody", () => {
  const arriving = {
    getType: () => "m.call.replaces",
    getLocalAge: () => 100,
    getContent: () => ({ call_id: "call-1", create_call: "call-9", target_user: { id: "@carol:localhost" } })
  };

  assert.equal(mapTransfer(arriving, { roomId: "!room:localhost" }, { caughtUp: false }), undefined);
  assert.ok(mapTransfer(arriving, { roomId: "!room:localhost" }, { caughtUp: true }));
});
