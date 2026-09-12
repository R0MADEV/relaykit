import assert from "node:assert/strict";
import test from "node:test";
import { MatrixEvent, RelationType } from "matrix-js-sdk";

const { isMessageEdit, mapMessage } = await import("../packages/matrix-js/dist/matrix-mapper.js");

/**
 * What a message is about — the one it edits, the one it answers, the thread it hangs from — travels outside
 * the encryption. It has to: a homeserver that cannot read the message still has to know what it relates to
 * in order to hand it to whoever asks for that thread.
 *
 * The spec allows a client to send it only out there, and the SDK reads it only from out there — it says so
 * in a comment of its own. What this library used to read was the decrypted content alone.
 *
 * In practice nothing broke: this SDK writes it in both places, and the smoke against a real homeserver
 * passes either way. That is the whole reason for this file — a client that does what the spec allows and
 * sends it only outside would have arrived as an edit that looks said all over again, an answer that lost
 * what it answered, and a thread reply in the middle of the talk, and nothing here would have noticed until
 * somebody else's client turned up.
 */
function asItArrivesInAnEncryptedRoom(content, relation) {
  const event = new MatrixEvent({
    type: "m.room.message",
    event_id: `$${Math.random()}`,
    sender: "@alice:localhost",
    room_id: "!room:localhost",
    origin_server_ts: Date.now(),
    content
  });
  // Encrypting lifts the relation out: the text goes inside, what it relates to stays outside.
  event.makeEncrypted(
    "m.room.encrypted",
    { algorithm: "m.megolm.v1.aes-sha2", ciphertext: "…", "m.relates_to": relation },
    "a-key",
    "a-key"
  );
  return event;
}

test("an edit in an encrypted conversation is still an edit", () => {
  const edit = asItArrivesInAnEncryptedRoom(
    { msgtype: "m.text", body: "* corrected", "m.new_content": { msgtype: "m.text", body: "corrected" } },
    { rel_type: RelationType.Replace, event_id: "$original" }
  );

  assert.equal(isMessageEdit(edit), true, "an edit arrived looking like something said all over again");
});

test("an answer in an encrypted conversation still says what it answers", () => {
  const answer = asItArrivesInAnEncryptedRoom(
    { msgtype: "m.text", body: "of course" },
    { "m.in_reply_to": { event_id: "$asked" } }
  );

  assert.equal(mapMessage(answer)?.replyToId, "$asked", "an answer lost what it was answering");
});

test("a thread reply in an encrypted conversation still belongs to its thread", () => {
  const inThread = asItArrivesInAnEncryptedRoom(
    { msgtype: "m.text", body: "inside the thread" },
    { rel_type: RelationType.Thread, event_id: "$root" }
  );

  assert.equal(mapMessage(inThread)?.threadId, "$root", "a thread reply landed in the middle of the talk");
});
