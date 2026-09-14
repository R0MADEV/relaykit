import assert from "node:assert/strict";
import test from "node:test";
import { numberAt, stringAt, stringsAt } from "../packages/matrix-js/dist/reading-content.js";

test("a field is read as what it should be, or not at all", () => {
  assert.equal(stringAt({ uri: "geo:1,2" }, "uri"), "geo:1,2");
  assert.equal(stringAt({ uri: 7 }, "uri"), undefined);
  assert.equal(numberAt({ duration: 1200 }, "duration"), 1200);
  assert.equal(numberAt({ duration: "1200" }, "duration"), undefined);
});

test("what is not there, and what is not an object, read as nothing rather than throwing", () => {
  for (const nothing of [undefined, null, "algo", 7, []]) {
    assert.equal(stringAt(nothing, "uri"), undefined);
    assert.equal(numberAt(nothing, "duration"), undefined);
    assert.deepEqual(stringsAt(nothing, "answers"), []);
  }
  assert.equal(stringAt({}, "uri"), undefined);
});

test("a list keeps only what belongs in it", () => {
  assert.deepEqual(stringsAt({ answers: ["a", 2, null, "b"] }, "answers"), ["a", "b"]);
  assert.deepEqual(stringsAt({ answers: "a" }, "answers"), []);
});

test("a homeserver cannot reach through a field name to something this never meant to read", () => {
  // `{}.constructor` is a function, `{}.toString` is a function: reading by name has to mean the thing
  // itself said it, not something every object in the language happens to have.
  assert.equal(stringAt({}, "constructor"), undefined);
  assert.equal(stringAt({}, "toString"), undefined);
  assert.equal(numberAt({}, "__proto__"), undefined);
});

test("a number that is not a number is not a number", () => {
  assert.equal(numberAt({ duration: Number.NaN }, "duration"), undefined);
  assert.equal(numberAt({ duration: Number.POSITIVE_INFINITY }, "duration"), undefined);
});
