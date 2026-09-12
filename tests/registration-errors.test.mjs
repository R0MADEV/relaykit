import assert from "node:assert/strict";
import test from "node:test";
import { MatrixError } from "matrix-js-sdk";

const { whatTheHomeserverMeant } = await import("../packages/matrix-js/dist/matrix-auth.js");

/**
 * Homeservers do not agree on when they check a username. Synapse says it is taken on the first word, before
 * asking anything else. Dendrite asks what it wants first and says it on the second, once the conversation is
 * finished.
 *
 * Both are answering the same thing, so an application must not have to tell them apart: "that name is taken"
 * has to come back as "that name is taken" whenever it is said, not as an unreadable adapter failure because
 * it was said a step later than expected.
 */
test("a name already taken says so, whenever the homeserver gets round to checking it", () => {
  const taken = whatTheHomeserverMeant(new MatrixError({ errcode: "M_USER_IN_USE" }, 400));

  assert.equal(taken?.code, "USERNAME_TAKEN");
});

test("a homeserver that does not want new accounts says that, and not something unreadable", () => {
  const closed = whatTheHomeserverMeant(new MatrixError({ errcode: "M_FORBIDDEN" }, 403));

  assert.equal(closed?.code, "REGISTRATION_UNSUPPORTED");
});

test("anything else is left alone, because guessing at it would hide it", () => {
  assert.equal(whatTheHomeserverMeant(new MatrixError({ errcode: "M_LIMIT_EXCEEDED" }, 429)), undefined);
  assert.equal(whatTheHomeserverMeant(new Error("not from a homeserver at all")), undefined);
});
