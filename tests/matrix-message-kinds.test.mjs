import assert from "node:assert/strict";
import test from "node:test";
import { MsgType } from "matrix-js-sdk";

const { matrixTypeOf } = await import("../packages/matrix-js/dist/matrix-room-operations.js");

/**
 * What Matrix calls each kind of message. Two of ours have a name of their own there, and the third does
 * not: a sticker is not a message type but an event type, so as a message it goes as plain text and the
 * event around it is what makes it a sticker.
 *
 * Worth pinning because the answer for a kind Matrix has no name for is the easy one to get wrong, and
 * nothing said what it should be.
 */
test("a kind Matrix has a name for goes by that name", () => {
  assert.equal(matrixTypeOf("action"), MsgType.Emote);
  assert.equal(matrixTypeOf("notice"), MsgType.Notice);
});

test("a kind Matrix has no name for, and no kind at all, both go as plain text", () => {
  assert.equal(matrixTypeOf("sticker"), MsgType.Text);
  assert.equal(matrixTypeOf(undefined), MsgType.Text);
});
