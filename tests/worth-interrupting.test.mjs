import assert from "node:assert/strict";
import test from "node:test";
import { titleWith, worthInterrupting } from "../examples/web/src/app/telling.ts";

const about = (conversationId, isMention = false) => ({
  conversationId,
  messageId: "$one",
  senderId: "@bob:x",
  body: "algo",
  isMention
});

test("what arrives in the conversation being read, with the window in front, interrupts nobody", () => {
  assert.equal(worthInterrupting(about("!open"), { openId: "!open", looking: true }), false);
});

test("what arrives somewhere else is worth saying, even with the window in front", () => {
  assert.equal(worthInterrupting(about("!other"), { openId: "!open", looking: true }), true);
});

test("with the window away, even the conversation being read is worth saying", () => {
  assert.equal(worthInterrupting(about("!open"), { openId: "!open", looking: false }), true);
});

test("being named is worth saying wherever it happens", () => {
  assert.equal(worthInterrupting(about("!open", true), { openId: "!open", looking: true }), true);
});

test("the tab says how much is waiting, and says nothing when nothing is", () => {
  assert.equal(titleWith(0), "Deitu");
  assert.equal(titleWith(1), "(1) Deitu");
  assert.equal(titleWith(12), "(12) Deitu");
});

test("more waiting than anybody counts is said as more, not as a number nobody reads", () => {
  assert.equal(titleWith(99), "(99) Deitu");
  assert.equal(titleWith(100), "(99+) Deitu");
});
