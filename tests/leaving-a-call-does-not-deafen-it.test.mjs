import assert from "node:assert/strict";
import test from "node:test";
import { walkOutOf } from "../packages/matrix-js/dist/matrix-conference.js";

/**
 * The session a call is held in belongs to the SDK, which keeps one per room and hands the same one out
 * again next time. `stop()` is for a session you made yourself: among other things it unsubscribes from the
 * room's state, so the session stops noticing anybody joining — for ever, because the next call gets that
 * same deaf object back.
 *
 * That is why the third or fourth call in a room rang and was withdrawn a moment later, and why the SDK's own
 * log said "Called MembershipManager.leave() even though the MembershipManager is not running".
 *
 * Leaving is `leaveRoomSession()`, which takes the membership down and leaves the session listening.
 */
function aCallBeingLeft() {
  const asked = [];
  return {
    asked,
    going: {
      stopListening: () => asked.push("stopListening"),
      room: { disconnect: async () => asked.push("disconnect") },
      session: {
        isJoined: () => true,
        leaveRoomSession: async () => asked.push("leaveRoomSession"),
        stop: async () => asked.push("stop")
      }
    }
  };
}

test("leaving a call takes the membership down without stopping the shared session", async () => {
  const { going, asked } = aCallBeingLeft();

  await walkOutOf(going);

  assert.ok(asked.includes("leaveRoomSession"), "it did not take the membership down");
  assert.ok(
    !asked.includes("stop"),
    "it stopped a session the SDK owns and hands out again: the next call in this room will not be heard"
  );
});

test("a session that was never joined is not asked to leave", async () => {
  const { going, asked } = aCallBeingLeft();
  going.session.isJoined = () => false;

  await walkOutOf(going);

  assert.deepEqual(asked, ["stopListening", "disconnect"]);
});
