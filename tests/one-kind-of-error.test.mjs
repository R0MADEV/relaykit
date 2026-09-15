import assert from "node:assert/strict";
import test from "node:test";
import { ConnectionError, MatrixError } from "matrix-js-sdk";
import { RelayKitError } from "@relaykit/core";
import { translateMatrixError } from "../packages/matrix-js/dist/matrix-errors.js";

/** A homeserver's refusal, shaped the way matrix-js-sdk shapes one. */
function refusedWith(errcode, said, httpStatus = 403) {
  return new MatrixError({ errcode, error: said }, httpStatus);
}

/** Every word this library will say. Anything else means a homeserver's wording got through. */
const ourOwnWords = [
  "The client has not been started",
  "The client is already started",
  "The client is not configured for that",
  "The session is no longer valid, sign in again",
  "The server would not accept that",
  "There is no such message",
  "There is no such conversation",
  "There is no such verification",
  "This account is not allowed to do that",
  "This homeserver does not do that",
  "The homeserver is asking this client to slow down",
  "That username is already taken",
  "This homeserver does not allow creating accounts",
  "The homeserver could not be reached",
  "The local copy could not be read or written",
  "The local copy could not be emptied",
  "The homeserver refused the request"
];

// The four that really came back from Synapse while this library was being built. None of them had a code
// worth branching on before, and all four handed the homeserver's own English to whoever was reading.
//
// The third is "not found" with nothing saying what was being looked for, and it stays ADAPTER_ERROR on
// purpose: a homeserver says that the same way about a room, an event and a file, so guessing would mean a
// failed download coming back as a conversation that is gone.
const reallyHappened = [
  ["M_FORBIDDEN", "You don't have permission to access that event.", 403, "FORBIDDEN"],
  ["M_GUEST_ACCESS_FORBIDDEN", "Guest access not allowed", 403, "FORBIDDEN"],
  ["M_UNKNOWN", "No row found (access_tokens)", 404, "ADAPTER_ERROR"],
  ["M_UNKNOWN", "Unable to get validated threepid", 401, "INVALID_SESSION"]
];

test("what really came back from a homeserver is said in this library's words", () => {
  for (const [errcode, said, status, expected] of reallyHappened) {
    const translated = translateMatrixError(refusedWith(errcode, said, status));

    assert.ok(translated instanceof RelayKitError, `${errcode} did not come back as one of ours`);
    assert.equal(translated.code, expected, `${errcode} (${status}) was read as ${translated.code}`);
    assert.ok(
      ourOwnWords.includes(translated.message),
      `the message for ${errcode} was «${translated.message}», which nobody here wrote`
    );
    assert.ok(!translated.message.includes(said), "the homeserver's own wording reached the message");
    assert.ok(translated.detail?.includes(said), "and what it said was not kept for the log either");
  }
});

test("a homeserver that says nothing at all is still answered with a code", () => {
  const translated = translateMatrixError(new MatrixError({}, 500));
  assert.equal(translated.code, "ADAPTER_ERROR");
  assert.equal(translated.message, "The homeserver refused the request");
});

test("a homeserver that could not be reached is told apart from one that refused", () => {
  const translated = translateMatrixError(new ConnectionError("fetch failed"));
  assert.equal(translated.code, "NETWORK_ERROR");
  assert.ok(!translated.message.includes("fetch failed"));
});

test("being told to slow down carries how long, because a retry needs it", () => {
  const tooFast = new MatrixError({ errcode: "M_LIMIT_EXCEEDED", retry_after_ms: 4321 }, 429);
  const translated = translateMatrixError(tooFast);
  assert.equal(translated.code, "RATE_LIMITED");
  assert.equal(translated.retryAfterMs, 4321);
});

test("something that is not the homeserver at all is still one of ours", () => {
  const translated = translateMatrixError(new TypeError("cannot read properties of undefined"));
  assert.ok(translated instanceof RelayKitError);
  assert.equal(translated.code, "ADAPTER_ERROR");
  assert.ok(!translated.message.includes("undefined"), "a bug in here is not a sentence for a screen");
  assert.ok(translated.detail?.includes("undefined"), "but it has to be findable in a log");
});

test("one of ours passes through untouched, so translating twice changes nothing", () => {
  const mine = new RelayKitError("INVALID_INPUT", "A reason is required");
  assert.equal(translateMatrixError(mine), mine);
});

test("the homeserver's own code is kept in the detail, because that is what a bug report needs", () => {
  const translated = translateMatrixError(refusedWith("M_WEAK_PASSWORD", "Too weak", 400));
  assert.equal(translated.code, "INVALID_INPUT");
  assert.ok(translated.detail?.startsWith("M_WEAK_PASSWORD: "));
});
