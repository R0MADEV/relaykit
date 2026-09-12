import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Nothing in the adapter types out a Matrix name the SDK already keeps as a constant.
 *
 * They look harmless: `m.login.password` reads better than `AuthType.Password`. But some of them are not the
 * string the SDK uses — `M_TEXT` is `org.matrix.msc1767.text`, not `m.text` — and a name typed out by hand is
 * a name nothing keeps up to date when a proposal settles and the SDK moves to the stable one.
 *
 * This reads the source rather than the behaviour on purpose: what is being checked is that we asked the SDK
 * instead of writing it out, which is not something the result can show.
 */
const typedOutByHand = [
  { name: "m.login.password", instead: "AuthType.Password" },
  { name: "m.login.dummy", instead: "AuthType.Dummy" },
  { name: "m.poll.undisclosed", instead: "M_POLL_KIND_UNDISCLOSED.name" },
  { name: "org.matrix.msc3488.location", instead: "M_LOCATION.name" },
  { name: "org.matrix.msc3488.ts", instead: "M_TIMESTAMP.name" },
  { name: "org.matrix.msc3488.asset", instead: "M_ASSET.name" },
  { name: "m.reference", instead: "RelationType.Reference" }
];

const sources = [
  "matrix-auth",
  "matrix-polls",
  "matrix-location",
  "matrix-mapper",
  "matrix-profiles",
  "matrix-security",
  "matrix-room-operations",
  "matrix-conversations",
  "matrix-details"
].map(name => ({ name, code: readFileSync(`packages/matrix-js/src/${name}.ts`, "utf8") }));

for (const { name, instead } of typedOutByHand) {
  test(`"${name}" is asked of the SDK as ${instead}, not typed out`, () => {
    const wrote = sources.filter(source => source.code.includes(`"${name}"`));

    assert.deepEqual(
      wrote.map(source => source.name),
      [],
      `typed out in: ${wrote.map(s => s.name)}`
    );
  });
}

/**
 * Shapes the SDK builds are asked of the SDK rather than assembled here.
 *
 * These two produce the same thing today — the test above says so by comparing them — so nothing is broken.
 * What is wrong is who is keeping them the same: a proposal that is still moving, copied out by hand, stays
 * right only for as long as somebody remembers to look. `ContentHelpers` is the SDK keeping it for us.
 */
test("what the SDK builds is not assembled by hand", () => {
  const location = sources.find(source => source.name === "matrix-location").code;

  assert.ok(location.includes("ContentHelpers"), "sharing where somebody is builds its own shape by hand");
});
