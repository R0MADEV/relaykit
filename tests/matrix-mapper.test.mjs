import assert from "node:assert/strict";
import test from "node:test";
import { MatrixError, MatrixEvent } from "matrix-js-sdk";
import * as mapper from "../packages/matrix-js/dist/matrix-mapper.js";
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

  assert.deepEqual(mapReadReceipts(event, roomId), [
    { conversationId: roomId, messageId: "$one", userId: "@bob:example.org", readAt: 10 },
    { conversationId: roomId, messageId: "$one", userId: "@carol:example.org", readAt: 20 },
    { conversationId: roomId, messageId: "$two", userId: "@bob:example.org", readAt: 30 }
  ]);
});

test("a receipt with no room of its own is placed by the room it was told about", () => {
  // This is what a real homeserver sends: the ephemeral event carries no room id at all.
  const event = new MatrixEvent({
    type: "m.receipt",
    content: { "$one": { "m.read": { "@bob:example.org": { ts: 10 } } } }
  });

  assert.deepEqual(mapReadReceipts(event, roomId), [
    { conversationId: roomId, messageId: "$one", userId: "@bob:example.org", readAt: 10 }
  ]);
});

test("a receipt belonging to no room at all is dropped", () => {
  const event = new MatrixEvent({
    type: "m.receipt",
    content: { "$one": { "m.read": { "@bob:example.org": { ts: 10 } } } }
  });

  assert.deepEqual(mapReadReceipts(event, undefined), []);
});

test("mapTyping maps the typing user list of a room", () => {
  const event = new MatrixEvent({ type: "m.typing", room_id: roomId, content: { user_ids: ["@bob:example.org"] } });

  assert.deepEqual(mapTyping(event, roomId), { conversationId: roomId, userIds: ["@bob:example.org"] });
});

test("a typing notification with no room of its own is placed by the room it was told about", () => {
  // This is what a real homeserver sends: the ephemeral event carries no room id at all.
  const event = new MatrixEvent({ type: "m.typing", content: { user_ids: ["@bob:example.org"] } });

  assert.deepEqual(mapTyping(event, roomId), { conversationId: roomId, userIds: ["@bob:example.org"] });
});

test("a typing notification belonging to no room at all is dropped", () => {
  const event = new MatrixEvent({ type: "m.typing", content: { user_ids: ["@bob:example.org"] } });

  assert.equal(mapTyping(event, undefined), undefined);
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
    findEventById: id => eventsById[id],
    // A room that is ready and says nothing about encryption, which is what sending waits on.
    getMyMembership: () => "join",
    currentState: { getStateEvents: () => null }
  };
  return {
    calls,
    getCrypto: () => undefined,
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
    getCrypto: () => undefined,
    getRoom: () => ({
      roomId,
      getEventForTxnId: () => undefined,
      findEventById: () => undefined,
      getMyMembership: () => "join",
      currentState: { getStateEvents: () => null }
    }),
    sendMessage: async () => { throw matrixError({ httpStatus: 429, errcode: "M_LIMIT_EXCEEDED", data: { retry_after_ms: 1000 } }); }
  };
  const adapter = new MatrixJsAdapter();
  // Reaching into the runtime is the only way to exercise the adapter boundary without a homeserver.
  // The whole of what the adapter asks of its runtime, or the double lies about how the real one behaves.
  adapter.runtime = { getClient: () => client, reachFor: async () => {}, widenTheWindow: async () => {} };

  await assert.rejects(
    adapter.sendMessage(roomId, "hola", { transactionId: "txn-1" }),
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

function fakeRoom(members, state = {}) {
  return {
    roomId,
    name: "Grupo",
    getLiveTimeline: () => ({ getEvents: () => [] }),
    getMembers: () => members,
    getMyMembership: () => "join",
    getUnreadNotificationCount: () => 0,
    getDMInviter: () => undefined,
    hasEncryptionStateEvent: () => false,
    // A real room always has state, even when it says nothing about itself. The accessors the SDK offers read
    // the same events, so the double answers them from the same place rather than from a second source.
    isSpaceRoom: () => state["m.room.create"]?.type === "m.space",
    getCanonicalAlias: () => state["m.room.canonical_alias"]?.alias ?? null,
    getJoinRule: () => state["m.room.join_rules"]?.join_rule ?? "invite",
    currentState: {
      getStateEvents: type => (type in state ? { getContent: () => state[type] } : null),
      getHistoryVisibility: () => state["m.room.history_visibility"]?.history_visibility ?? "shared"
    },
    getAccountData: type => {
      const content = state.accountData?.[type];
      return content ? { getContent: () => content } : undefined;
    },
    client: { getAccountData: () => undefined, pushRules: state.pushRules }
  };
}

test("a sticker that arrives is told apart from an attachment", () => {
  const { mapMessage } = mapper;
  const evento = {
    getId: () => "$pegatina",
    getRoomId: () => roomId,
    getSender: () => "@bob:example.org",
    getType: () => "m.sticker",
    getTs: () => 1000,
    getContent: () => ({
      body: "saludo",
      url: "mxc://example.org/pegatina",
      info: { mimetype: "image/png", size: 120, w: 128, h: 128 }
    }),
    getUnsigned: () => ({}),
    isRedacted: () => false,
    getRelation: () => null,
    isEncrypted: () => false,
    isDecryptionFailure: () => false,
    replacingEvent: () => null,
    getWireType: () => "m.sticker"
  };

  const mensaje = mapMessage(evento);

  assert.equal(mensaje.kind, "sticker");
  assert.equal(mensaje.attachment.mimeType, "image/png");
  assert.equal(mensaje.attachment.width, 128);
});

test("a conversation says whether it really is encrypted, not what was asked for", () => {
  const { mapConversation } = mapper;
  const cifrada = fakeRoom([]);
  cifrada.hasEncryptionStateEvent = () => true;
  const enClaro = fakeRoom([]);
  enClaro.hasEncryptionStateEvent = () => false;

  // The homeserver can encrypt by policy even though nobody asked, and encryption cannot be taken off.
  // Assuming is how you end up believing support can read a history that is a locked box.
  assert.equal(mapConversation(cifrada).isEncrypted, true);
  assert.equal(mapConversation(enClaro).isEncrypted, false);
});

test("a conversation somebody left for later says so when it comes back from the homeserver", () => {
  const { mapConversation } = mapper;
  const room = fakeRoom([], { accountData: { "m.marked_unread": { unread: true } } });

  assert.equal(mapConversation(room).isUnread, true);
});

test("a conversation nobody left for later does not claim to be unread", () => {
  const { mapConversation } = mapper;

  assert.equal(mapConversation(fakeRoom([])).isUnread, undefined);
  assert.equal(mapConversation(fakeRoom([], { accountData: { "m.marked_unread": { unread: false } } })).isUnread, false);
});

test("a conversation that was replaced points at the one that carries on", () => {
  const { mapConversation } = mapper;
  const room = fakeRoom([{ userId: "@alice:example.org", membership: "join" }], {
    "m.room.tombstone": { replacement_room: "!nueva:example.org", body: "esta sala continua en otra" }
  });

  assert.equal(mapConversation(room).replacedBy, "!nueva:example.org");
});

test("a conversation that replaced another points back at it", () => {
  const { mapConversation } = mapper;
  const room = fakeRoom([{ userId: "@alice:example.org", membership: "join" }], {
    "m.room.create": { predecessor: { room_id: "!vieja:example.org" } }
  });

  assert.equal(mapConversation(room).replaces, "!vieja:example.org");
});

test("a conversation nobody replaced points nowhere", () => {
  const { mapConversation } = mapper;

  const conversation = mapConversation(fakeRoom([{ userId: "@alice:example.org", membership: "join" }]));

  assert.equal(conversation.replacedBy, undefined);
  assert.equal(conversation.replaces, undefined);
});

test("a conversation carries the name people can type", () => {
  const { mapConversation } = mapper;
  const room = fakeRoom([{ userId: "@alice:example.org", membership: "join" }], {
    "m.room.canonical_alias": { alias: "#soporte:example.org" }
  });

  assert.equal(mapConversation(room).alias, "#soporte:example.org");
});

test("a conversation says where this person stopped reading", () => {
  const { mapConversation } = mapper;
  const room = fakeRoom([{ userId: "@alice:example.org", membership: "join" }], {
    accountData: { "m.fully_read": { event_id: "$hasta-aqui" } }
  });

  assert.equal(mapConversation(room).lastReadMessageId, "$hasta-aqui");
});

test("a conversation nobody has read says nothing about where they stopped", () => {
  const { mapConversation } = mapper;

  const conversation = mapConversation(fakeRoom([{ userId: "@alice:example.org", membership: "join" }]));

  assert.equal(conversation.lastReadMessageId, undefined);
});

test("a place arrives as a place, with the description the sender wrote", () => {
  const event = new MatrixEvent({
    type: "m.room.message",
    event_id: "$place",
    sender: "@alice:example.org",
    room_id: roomId,
    origin_server_ts: 1000,
    content: {
      msgtype: "m.location",
      body: "Bilbao",
      geo_uri: "geo:43.263,-2.935",
      "org.matrix.msc3488.location": { uri: "geo:43.263,-2.935", description: "Bilbao" }
    }
  });

  const message = mapMessage(event);

  assert.equal(message.location.latitude, 43.263);
  assert.equal(message.location.longitude, -2.935);
  assert.equal(message.location.description, "Bilbao");
});

test("a voice note is told apart from an audio file somebody attached", () => {
  const voice = new MatrixEvent({
    type: "m.room.message",
    event_id: "$voice",
    sender: "@alice:example.org",
    room_id: roomId,
    origin_server_ts: 1000,
    content: {
      msgtype: "m.audio",
      body: "nota.ogg",
      url: "mxc://example.org/voice",
      info: { mimetype: "audio/ogg", size: 4, duration: 3200 },
      "org.matrix.msc3245.voice": {},
      "org.matrix.msc1767.audio": { duration: 3200, waveform: [0, 512] }
    }
  });
  const song = new MatrixEvent({
    type: "m.room.message",
    event_id: "$song",
    sender: "@alice:example.org",
    room_id: roomId,
    origin_server_ts: 1000,
    content: { msgtype: "m.audio", body: "cancion.mp3", url: "mxc://example.org/song", info: { mimetype: "audio/mpeg" } }
  });

  assert.equal(mapMessage(voice).attachment.voice.durationMs, 3200);
  assert.deepEqual(mapMessage(voice).attachment.voice.waveform, [0, 512]);
  assert.equal(mapMessage(song).attachment.voice, undefined);
});

test("a conversation says who may come in and how far back people can read", () => {
  const { mapConversation } = mapper;
  const room = fakeRoom([{ userId: "@alice:example.org", membership: "join" }], {
    "m.room.join_rules": { join_rule: "knock" },
    "m.room.history_visibility": { history_visibility: "world_readable" }
  });

  const conversation = mapConversation(room);

  assert.equal(conversation.joinRule, "knock");
  assert.equal(conversation.historyVisibility, "world");
});

test("people waiting at the door are not participants yet", () => {
  const { mapConversation } = mapper;
  const room = fakeRoom([
    { userId: "@alice:example.org", membership: "join" },
    { userId: "@carol:example.org", membership: "knock" }
  ]);

  const conversation = mapConversation(room);

  assert.deepEqual(conversation.knockingIds, ["@carol:example.org"]);
  assert.deepEqual(conversation.participantIds, ["@alice:example.org"]);
});

test("a silenced conversation is read back as silenced", () => {
  const { mapConversation } = mapper;
  const room = fakeRoom([{ userId: "@alice:example.org", membership: "join" }], {
    pushRules: { global: { override: [{ rule_id: roomId, enabled: true, actions: [] }] } }
  });

  assert.equal(mapConversation(room).notifications, "none");
});

test("a conversation that only speaks up for mentions is read back that way", () => {
  const { mapConversation } = mapper;
  const room = fakeRoom([{ userId: "@alice:example.org", membership: "join" }], {
    pushRules: { global: { room: [{ rule_id: roomId, enabled: true, actions: [] }] } }
  });

  assert.equal(mapConversation(room).notifications, "mentions");
});

test("a conversation nobody silenced says nothing about notifications", () => {
  const { mapConversation } = mapper;
  const room = fakeRoom([{ userId: "@alice:example.org", membership: "join" }], { pushRules: { global: {} } });

  assert.equal(mapConversation(room).notifications, undefined);
});

test("a conversation carries the description and the picture the room has", () => {
  const { mapConversation } = mapper;
  const room = fakeRoom([{ userId: "@alice:example.org", membership: "join" }], {
    "m.room.topic": { topic: "Lo que hablamos aqui" },
    "m.room.avatar": { url: "mxc://example.org/grupo" }
  });

  const conversation = mapConversation(room);

  assert.equal(conversation.topic, "Lo que hablamos aqui");
  assert.equal(JSON.parse(conversation.avatar.source).url, "mxc://example.org/grupo");
});

test("a conversation without a description or a picture says nothing about them", () => {
  const { mapConversation } = mapper;

  const conversation = mapConversation(fakeRoom([{ userId: "@alice:example.org", membership: "join" }]));

  assert.equal(conversation.topic, undefined);
  assert.equal(conversation.avatar, undefined);
});

test("the participants of a conversation are those in it, not those who left", () => {
  const { mapConversation } = mapper;
  const room = fakeRoom([
    { userId: "@alice:example.org", membership: "join" },
    { userId: "@bob:example.org", membership: "join" },
    { userId: "@carol:example.org", membership: "leave" },
    { userId: "@dave:example.org", membership: "invite" },
    { userId: "@eve:example.org", membership: "ban" }
  ]);

  const conversation = mapConversation(room);

  assert.deepEqual(conversation.participantIds, ["@alice:example.org", "@bob:example.org", "@dave:example.org"]);
});

const { waitUntilRoomIsUsable } = await import("../packages/matrix-js/dist/matrix-room-operations.js");

function joiningRoom(readyAfter) {
  let polls = 0;
  return {
    roomId,
    get polls() { return polls; },
    getMyMembership: () => (polls++ >= readyAfter ? "join" : "invite"),
    currentState: { getStateEvents: () => (polls > readyAfter ? {} : null) }
  };
}

test("a room just joined is only usable once its state has arrived", async () => {
  const room = joiningRoom(2);

  await waitUntilRoomIsUsable(room, 2000);

  assert.ok(room.polls > 2, "it must keep looking until the room is ready");
});

test("waiting for a room that never becomes usable fails with a clear reason", async () => {
  const never = { roomId, getMyMembership: () => "invite", currentState: { getStateEvents: () => null } };

  await assert.rejects(waitUntilRoomIsUsable(never, 300), /not ready/);
});

test("a conversation says who has been invited and has not accepted yet", () => {
  const { mapConversation } = mapper;
  const room = fakeRoom([
    { userId: "@alice:example.org", membership: "join" },
    { userId: "@bob:example.org", membership: "join" },
    { userId: "@dave:example.org", membership: "invite" },
    { userId: "@carol:example.org", membership: "leave" }
  ]);

  const conversation = mapConversation(room);

  assert.deepEqual(conversation.participantIds, ["@alice:example.org", "@bob:example.org", "@dave:example.org"]);
  assert.deepEqual(conversation.invitedIds, ["@dave:example.org"]);
});

test("the timeline leaves out messages the homeserver has not accepted yet", () => {
  const { mapMessages } = mapper;
  const pending = new MatrixEvent({
    type: "m.room.message",
    event_id: `~${roomId}:txn-1`,
    sender: "@alice:example.org",
    room_id: roomId,
    origin_server_ts: 1000,
    content: { msgtype: "m.text", body: "sin confirmar" }
  });
  const accepted = new MatrixEvent({
    type: "m.room.message",
    event_id: "$accepted",
    sender: "@alice:example.org",
    room_id: roomId,
    origin_server_ts: 2000,
    content: { msgtype: "m.text", body: "confirmado" }
  });

  const messages = mapMessages([pending, accepted]);

  assert.deepEqual(messages.map(message => message.body), ["confirmado"]);
});

const { handleClientEvent } = await import("../packages/matrix-js/dist/matrix-handlers.js");

test("a presence event arriving on the general stream is passed on", () => {
  // The stream tied to each person is not reliable: it only fires when the sdk happens to have built that
  // person's object with re-emission set up, so presence has to be taken from the general stream.
  const seen = [];
  const event = new MatrixEvent({
    type: "m.presence",
    sender: "@bob:example.org",
    content: { presence: "unavailable", last_active_ago: 10 }
  });

  handleClientEvent(event, { onPresenceChanged: presence => seen.push(presence) });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].userId, "@bob:example.org");
  assert.equal(seen[0].presence, "unavailable");
});

test("anything else on the general stream is left alone", () => {
  const seen = [];
  const event = new MatrixEvent({ type: "m.typing", content: { user_ids: [] } });

  handleClientEvent(event, { onPresenceChanged: presence => seen.push(presence) });

  assert.deepEqual(seen, []);
});
