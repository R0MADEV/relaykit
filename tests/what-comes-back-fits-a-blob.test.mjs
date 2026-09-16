import assert from "node:assert/strict";
import test from "node:test";

/**
 * What a browser does with an avatar or an attachment is put it in a `Blob` and hand it to an `<img>`. That
 * has to compile without anybody reaching for a cast: a library whose own documented example does not type
 * check is a library making its users do something awkward and never hearing about it.
 *
 * `Uint8Array` on its own means `Uint8Array<ArrayBufferLike>`, and `ArrayBufferLike` includes
 * `SharedArrayBuffer`, which a `Blob` will not take. Nothing here is ever shared, so saying so is both true
 * and the thing that makes the ordinary use work.
 */
test("the bytes that come back can be put in a Blob", async () => {
  const { readFileSync } = await import("node:fs");
  const models = [
    readFileSync("packages/core/src/models/messages.ts", "utf8"),
    readFileSync("packages/core/src/models/people.ts", "utf8")
  ].join("\n");

  const bare = [...models.matchAll(/readonly data: Uint8Array;/g)];
  assert.equal(
    bare.length,
    0,
    "a bare Uint8Array is Uint8Array<ArrayBufferLike>, which a Blob refuses: say Uint8Array<ArrayBuffer>"
  );
});
