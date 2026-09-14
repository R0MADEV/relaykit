import assert from "node:assert/strict";
import test from "node:test";
import { grouped } from "../examples/web/src/app/reacting.ts";

const left = (id, senderId, key) => ({ id, senderId, key, messageId: "$one", createdAt: 1 });

test("the same key left by several people is one pill with a number", () => {
  assert.deepEqual(
    grouped([left("a", "@ana:x", "👍"), left("b", "@bob:x", "👍"), left("c", "@bob:x", "🎉")], "@carol:x"),
    [
      { key: "👍", count: 2, mine: undefined },
      { key: "🎉", count: 1, mine: undefined }
    ]
  );
});

test("a pill knows which one is yours, so pressing it can take it back", () => {
  assert.deepEqual(grouped([left("a", "@ana:x", "👍"), left("b", "@bob:x", "👍")], "@bob:x"), [
    { key: "👍", count: 2, mine: "b" }
  ]);
});

test("pills come in the order the first of each was left", () => {
  assert.deepEqual(
    grouped([left("a", "@ana:x", "🎉"), left("b", "@bob:x", "👍")], "@ana:x").map(pill => pill.key),
    ["🎉", "👍"]
  );
});

test("a message nobody reacted to has no pills", () => {
  assert.deepEqual(grouped(undefined, "@ana:x"), []);
  assert.deepEqual(grouped([], "@ana:x"), []);
});
