import assert from "node:assert/strict";
import test from "node:test";
import { kindOf } from "../examples/web/src/app/attachments.ts";

test("a picture, a film and a recording are each shown as what they are", () => {
  assert.equal(kindOf("image/png"), "picture");
  assert.equal(kindOf("image/svg+xml"), "picture");
  assert.equal(kindOf("video/mp4"), "film");
  assert.equal(kindOf("audio/ogg"), "recording");
});

test("anything else is a file, which is a name and a way to save it", () => {
  assert.equal(kindOf("application/pdf"), "file");
  assert.equal(kindOf("text/plain"), "file");
  assert.equal(kindOf(""), "file");
  assert.equal(kindOf(undefined), "file");
});

test("the type is read as a type, not as text that happens to contain a word", () => {
  // Anybody can name a file, and a name is not a type: what decides is the type it travelled with.
  assert.equal(kindOf("application/x-image-thing"), "file");
  assert.equal(kindOf("IMAGE/PNG"), "picture");
});
