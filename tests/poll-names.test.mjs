import assert from "node:assert/strict";
import test from "node:test";
import { M_POLL_START, M_POLL_KIND_UNDISCLOSED, M_TEXT } from "matrix-js-sdk";

const { startMatrixPoll } = await import("../packages/matrix-js/dist/matrix-polls.js");

/**
 * A poll is written with the names the SDK itself uses, not with names typed out here.
 *
 * These are not the same string. `M_TEXT` is `org.matrix.msc1767.text` while the settled name is `m.text`,
 * and until the proposal settles that is what everybody else writes and looks for. Typing out the other one
 * makes a poll that only this library can read, and nothing here would ever notice: both sides of every
 * check are this same code.
 */
test("a poll is written with the SDK's own names, so anybody else can read it", async () => {
  let written;
  const client = {
    sendEvent: async (_room, _type, content) => { written = content; return { event_id: "$1" }; },
    getRoom: () => ({ getLiveTimeline: () => ({ getEvents: () => [{ getId: () => "$1" }] }) })
  };

  await startMatrixPoll(client, "!room:localhost", { question: "¿Comemos?", answers: ["Sí", "No"] })
    .catch(() => undefined);

  const poll = written[M_POLL_START.name];
  assert.equal(poll.kind, M_POLL_KIND_UNDISCLOSED.name, "the kind of poll is not the one the SDK names");
  assert.equal(poll.question[M_TEXT.name], "¿Comemos?", "the question is not where the SDK looks for it");
  assert.equal(poll.answers[0][M_TEXT.name], "Sí", "an answer is not where the SDK looks for it");
  assert.equal(written[M_TEXT.name], undefined ?? written[M_TEXT.name], "sanity");
});
