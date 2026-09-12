import assert from "node:assert/strict";
import test from "node:test";

const { RecentIds } = await import("../packages/core/dist/recent-ids.js");

test("what has been seen is recognised", () => {
  const seen = new RecentIds(3);

  seen.add("one");

  assert.equal(seen.has("one"), true);
  assert.equal(seen.has("two"), false);
});

test("the oldest is forgotten once it is full", () => {
  const seen = new RecentIds(3);

  for (const id of ["one", "two", "three", "four"]) seen.add(id);

  assert.equal(seen.has("one"), false);
  assert.equal(seen.has("four"), true);
});

test("adding the same one again does not push anybody out", () => {
  const seen = new RecentIds(3);
  for (const id of ["one", "two", "three"]) seen.add(id);

  for (let index = 0; index < 100; index += 1) seen.add("three");

  assert.equal(seen.has("one"), true, "the oldest should still be here: nothing new arrived");
  assert.equal(seen.has("two"), true);
  assert.equal(seen.has("three"), true);
});

test("forgetting everything leaves nothing recognised", () => {
  const seen = new RecentIds(3);
  seen.add("one");

  seen.clear();

  assert.equal(seen.has("one"), false);
});

test("a list that remembers nothing recognises nothing", () => {
  const seen = new RecentIds(0);

  seen.add("one");

  assert.equal(seen.has("one"), false);
});
