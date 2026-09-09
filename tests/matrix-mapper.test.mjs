import assert from "node:assert/strict";
import test from "node:test";
import { MatrixError, MatrixEvent } from "matrix-js-sdk";
import {
  mapMessage,
  mapPresence,
  mapReadReceipts,
  mapRedactedMessage,
  mapTyping
} from "../packages/matrix-js/dist/matrix-mapper.js";

const roomId = "!room:example.org";

test("mapRedactedMessage builds a deleted message from a redacted message event", () => {
  const original = new MatrixEvent({
    type: "m.room.message",
    event_id: "$message",
    sender: "@bob:example.org",
    room_id: roomId,
    origin_server_ts: 1000,
    content: {}
  });
  const redaction = new MatrixEvent({
    type: "m.room.redaction",
    event_id: "$redaction",
    sender: "@bob:example.org",
    room_id: roomId,
    origin_server_ts: 2000,
    redacts: "$message",
    content: {}
  });

  assert.deepEqual(mapRedactedMessage(original, redaction), {
    id: "$message",
    conversationId: roomId,
    senderId: "@bob:example.org",
    body: "",
    createdAt: 1000,
    status: "sent",
    deletedAt: 2000
  });
});

test("mapRedactedMessage ignores redactions of non-message events", () => {
  const reaction = new MatrixEvent({ type: "m.reaction", event_id: "$reaction", sender: "@bob:example.org", room_id: roomId, content: {} });
  const redaction = new MatrixEvent({ type: "m.room.redaction", event_id: "$redaction", sender: "@bob:example.org", room_id: roomId, redacts: "$reaction", content: {} });

  assert.equal(mapRedactedMessage(reaction, redaction), undefined);
});

test("mapReadReceipts flattens m.read receipts into one receipt per user and message", () => {
  const event = new MatrixEvent({
    type: "m.receipt",
    room_id: roomId,
    content: {
      "$one": { "m.read": { "@bob:example.org": { ts: 10 }, "@carol:example.org": { ts: 20 } } },
      "$two": { "m.read": { "@bob:example.org": { ts: 30 } }, "m.read.private": { "@dave:example.org": { ts: 40 } } }
    }
  });

  assert.deepEqual(mapReadReceipts(event), [
    { conversationId: roomId, messageId: "$one", userId: "@bob:example.org", readAt: 10 },
    { conversationId: roomId, messageId: "$one", userId: "@carol:example.org", readAt: 20 },
    { conversationId: roomId, messageId: "$two", userId: "@bob:example.org", readAt: 30 }
  ]);
});

test("mapTyping maps the typing user list of a room", () => {
  const event = new MatrixEvent({ type: "m.typing", room_id: roomId, content: { user_ids: ["@bob:example.org"] } });

  assert.deepEqual(mapTyping(event), { conversationId: roomId, userIds: ["@bob:example.org"] });
});

test("mapPresence maps a presence event with status and last activity", () => {
  const event = new MatrixEvent({
    type: "m.presence",
    sender: "@bob:example.org",
    content: { presence: "unavailable", status_msg: "away", last_active_ago: 5000 }
  });

  const presence = mapPresence(event, 10000);

  assert.deepEqual(presence, { userId: "@bob:example.org", presence: "unavailable", statusMessage: "away", lastActiveAt: 5000 });
});

test("mapPresence rejects unknown presence states", () => {
  const event = new MatrixEvent({ type: "m.presence", sender: "@bob:example.org", content: { presence: "busy" } });

  assert.equal(mapPresence(event, 10000), undefined);
});

// --- sendWithTransaction: retry behaviour with no homeserver involved ---

const { sendWithTransaction } = await import("../packages/matrix-js/dist/matrix-room-operations.js");

function sentEvent({ id = "$sent", body = "hola", txnId } = {}) {
  return {
    getType: () => "m.room.message",
    getContent: () => ({ msgtype: "m.text", body }),
    getUnsigned: () => (txnId ? { transaction_id: txnId } : {}),
    getId: () => id,
    getSender: () => "@alice:example.org",
    getRoomId: () => roomId,
    getTs: () => 1000,
    isEncrypted: () => false,
    isDecryptionFailure: () => false
  };
}

function fakeClient({ pending, eventsById }) {
  const calls = { sendMessage: 0, resendEvent: 0 };
  const room = {
    roomId,
    getEventForTxnId: () => pending,
    findEventById: id => eventsById[id]
  };
  return {
    calls,
    getRoom: () => room,
    sendMessage: async () => { calls.sendMessage += 1; return { event_id: "$sent" }; },
    resendEvent: async () => { calls.resendEvent += 1; return { event_id: "$resent" }; }
  };
}

test("a first send goes straight to the homeserver and keeps its transaction id", async () => {
  const client = fakeClient({ pending: undefined, eventsById: { $sent: sentEvent() } });

  const message = await sendWithTransaction(client, roomId, { msgtype: "m.text", body: "hola" }, "txn-1");

  assert.equal(message.id, "$sent");
  assert.equal(message.transactionId, "txn-1");
  assert.deepEqual(client.calls, { sendMessage: 1, resendEvent: 0 });
});

test("retrying a failed send resends the pending event instead of queuing a duplicate", async () => {
  const pending = { ...sentEvent({ id: "$resent" }), status: "not_sent" };
  const client = fakeClient({ pending, eventsById: { $resent: sentEvent({ id: "$resent" }) } });

  const message = await sendWithTransaction(client, roomId, { msgtype: "m.text", body: "hola" }, "txn-1");

  assert.equal(message.id, "$resent");
  assert.equal(message.transactionId, "txn-1");
  assert.deepEqual(client.calls, { sendMessage: 0, resendEvent: 1 });
});

test("retrying a send that already succeeded returns it without sending again", async () => {
  const pending = { ...sentEvent(), status: "sent" };
  const client = fakeClient({ pending, eventsById: { $sent: sentEvent() } });

  const message = await sendWithTransaction(client, roomId, { msgtype: "m.text", body: "hola" }, "txn-1");

  assert.equal(message.id, "$sent");
  assert.deepEqual(client.calls, { sendMessage: 0, resendEvent: 0 });
});

test("retrying while the previous attempt is still in flight fails with a clear reason", async () => {
  const pending = { ...sentEvent({ id: "~!room:example.org:local" }), status: "sending" };
  const client = fakeClient({ pending, eventsById: {} });

  await assert.rejects(
    sendWithTransaction(client, roomId, { msgtype: "m.text", body: "hola" }, "txn-1"),
    /still in flight/
  );
});

// --- Matrix errors must not leak to the application ---

const { translateMatrixError } = await import("../packages/matrix-js/dist/matrix-errors.js");

// The real class, so the test cannot drift from what the homeserver errors actually look like.
function matrixError({ httpStatus, errcode, data = {} }) {
  return new MatrixError({ errcode, error: "test", ...data }, httpStatus);
}

test("a rate limit becomes a typed error carrying how long to wait", () => {
  const translated = translateMatrixError(matrixError({
    httpStatus: 429,
    errcode: "M_LIMIT_EXCEEDED",
    data: { retry_after_ms: 4200 }
  }));

  assert.equal(translated.name, "SdkError");
  assert.equal(translated.code, "RATE_LIMITED");
  assert.equal(translated.retryAfterMs, 4200);
});

test("an expired or revoked token becomes an invalid session error", () => {
  const translated = translateMatrixError(matrixError({ httpStatus: 401, errcode: "M_UNKNOWN_TOKEN" }));

  assert.equal(translated.code, "INVALID_SESSION");
});

test("errors that are not Matrix errors are passed through untouched", () => {
  const original = new Error("socket hang up");

  assert.equal(translateMatrixError(original), original);
});

test("the adapter reports a rate limited send as a typed error", async () => {
  const { MatrixJsAdapter } = await import("@relaykit/matrix-js");
  const client = {
    getRoom: () => ({ roomId, getEventForTxnId: () => undefined, findEventById: () => undefined }),
    sendMessage: async () => { throw matrixError({ httpStatus: 429, errcode: "M_LIMIT_EXCEEDED", data: { retry_after_ms: 1000 } }); }
  };
  const adapter = new MatrixJsAdapter();
  // Reaching into the runtime is the only way to exercise the adapter boundary without a homeserver.
  adapter.runtime = { getClient: () => client };

  await assert.rejects(
    adapter.sendMessage(roomId, "hola", "txn-1"),
    error => error.code === "RATE_LIMITED" && error.retryAfterMs === 1000
  );
});

test("mapMessage reads what a message replies to", () => {
  const reply = new MatrixEvent({
    type: "m.room.message",
    event_id: "$reply",
    sender: "@bob:example.org",
    room_id: roomId,
    origin_server_ts: 2000,
    content: { msgtype: "m.text", body: "me viene bien", "m.relates_to": { "m.in_reply_to": { event_id: "$original" } } }
  });

  const message = mapMessage(reply);

  assert.equal(message.id, "$reply");
  assert.equal(message.replyToId, "$original");
  assert.equal(message.body, "me viene bien");
});

test("any other homeserver error is still reported as an SDK error, never as a Matrix one", () => {
  const translated = translateMatrixError(matrixError({
    httpStatus: 404,
    errcode: "M_NOT_FOUND",
    data: { error: "Can't join remote room because no servers that are in the room have been provided." }
  }));

  assert.equal(translated.name, "SdkError");
  assert.equal(translated.code, "ADAPTER_ERROR");
  assert.match(translated.message, /no servers that are in the room/);
});

test("the adapter never lets a Matrix error reach the caller", async () => {
  const { MatrixJsAdapter } = await import("@relaykit/matrix-js");
  const adapter = new MatrixJsAdapter();
  adapter.runtime = {
    getClient: () => ({
      joinRoom: async () => { throw matrixError({ httpStatus: 404, errcode: "M_NOT_FOUND", data: { error: "no such room" } }); }
    })
  };

  await assert.rejects(adapter.joinConversation("!room:example.org"), error => error.name === "SdkError");
});

test("a message that cannot be decrypted is flagged instead of showing the internal placeholder", () => {
  const failed = new MatrixEvent({
    type: "m.room.message",
    event_id: "$failed",
    sender: "@bob:example.org",
    room_id: roomId,
    origin_server_ts: 3000,
    content: { msgtype: "m.bad.encrypted", body: "** Unable to decrypt: DecryptionError: no key **" }
  });
  failed.isDecryptionFailure = () => true;

  const message = mapMessage(failed);

  assert.equal(message.id, "$failed");
  assert.equal(message.undecryptable, true);
  assert.equal(message.body, "", "the internal placeholder must not reach the application");
});

test("a normal message is not flagged as undecryptable", () => {
  const normal = new MatrixEvent({
    type: "m.room.message",
    event_id: "$normal",
    sender: "@bob:example.org",
    room_id: roomId,
    origin_server_ts: 3000,
    content: { msgtype: "m.text", body: "hola" }
  });

  const message = mapMessage(normal);

  assert.equal(message.undecryptable, undefined);
  assert.equal(message.body, "hola");
});
