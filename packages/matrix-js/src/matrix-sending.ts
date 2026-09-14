/**
 * Putting a message on the wire, and getting back what it became.
 *
 * Apart from what a room is because it answers a different question: everything there is about reaching a
 * conversation and reading it, and this is about one message leaving — what it is on the wire, what it
 * carries besides its text, and how asking twice does not send it twice.
 */
import {
  RelationType,
  EventStatus,
  EventType,
  MatrixEvent,
  MsgType,
  type MatrixClient,
  type Room,
  ContentHelpers,
  LocationAssetType
} from "matrix-js-sdk";
import type { RoomMessageEventContent, StickerEventContent } from "matrix-js-sdk/lib/@types/events.js";
import type { ConversationId, Mentions, Message, MessageKind, SendContent } from "@relaykit/core";
import { mapMessage } from "./matrix-mapper.js";
import { waitUntilRoomIsUsable } from "./matrix-room-operations.js";

/**
 * What can be sent into a conversation as one event. A sticker carries body, info and url the way an image
 * message does — the spec says so — but the SDK names the two shapes apart, so both are said here and the
 * one line that hands it over says which of them it is.
 */
type SentContent = RoomMessageEventContent | StickerEventContent;

/**
 * Joining is answered before the room state has been synced, and a room without state cannot be encrypted
 * into. Waiting here means a conversation that was just joined can be used straight away.
 */
/**
 * Locking a message needs the conversation to have said how it is encrypted, and that piece of state arrives
 * with the rest. Saying something the moment a screen is painted, before it lands, fails with "unconfigured
 * room". There is no way to tell that apart beforehand from a conversation that simply is not encrypted: both
 * look like a room with nothing said about encryption. So the failure itself is the signal, and the wait only
 * happens when it is needed.
 */
function isEncryptionNotHereYet(error: unknown): boolean {
  const reason = error instanceof Error ? error.message : String(error);
  return reason.includes("unconfigured room");
}

async function waitUntilEncryptionIsKnown(
  client: MatrixClient,
  roomId: string,
  timeoutMs = 10000
): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await crypto.isEncryptionEnabledInRoom(roomId)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/** One attempt, and a second one for the only failure that is a matter of waiting rather than of asking. */
async function sendOnce(
  client: MatrixClient,
  conversationId: string,
  send: () => Promise<{ event_id: string }>
): Promise<{ event_id: string }> {
  try {
    return await send();
  } catch (error) {
    if (!isEncryptionNotHereYet(error)) throw error;
    await waitUntilEncryptionIsKnown(client, conversationId);
    return send();
  }
}

const messageTypes: Partial<Record<MessageKind, MsgType>> = { action: MsgType.Emote, notice: MsgType.Notice };

/**
 * What Matrix calls this kind of message. A sticker has no name of its own here: it is an event type, not a
 * message type, so as a message it goes as plain text and the event around it is what makes it a sticker.
 */
export function matrixTypeOf(kind: MessageKind | undefined): MsgType {
  return (kind && messageTypes[kind]) ?? MsgType.Text;
}

/**
 * Everything a message carries besides what it says and what kind it is: how it is written, who it names,
 * and what it answers.
 *
 * One type with optional parts, not a union of shapes. Spreading a variable whose type is a union gives
 * every missing key the type `never`, which nothing will accept — so this says the keys may be absent
 * instead of being a different shape when they are. `format` is the literal it has to be, not a string.
 */
interface AlsoSaid {
  format?: "org.matrix.custom.html";
  formatted_body?: string;
  "m.mentions"?: Named;
  "m.relates_to"?: Record<string, unknown>;
}

interface Named {
  user_ids?: string[];
  room?: true;
}

/** Who the message names, which is what decides whose screen lights up for it. */
function whoIsNamed(mentions: Mentions): Named {
  const named: Named = {};
  if (mentions.userIds) named.user_ids = [...mentions.userIds];
  if (mentions.everyone) named.room = true;
  return named;
}

function alsoSaidIn(options: SendContent): AlsoSaid {
  const said: AlsoSaid = {};
  if (options.formattedBody) {
    said.format = "org.matrix.custom.html";
    said.formatted_body = options.formattedBody;
  }
  if (options.mentions) said["m.mentions"] = whoIsNamed(options.mentions);
  const answering = relationFor(options.replyToId, options.threadId);
  if (answering) said["m.relates_to"] = answering;
  return said;
}

export function sendMessage(
  client: MatrixClient,
  conversationId: ConversationId,
  body: string,
  options: SendContent = {}
): Promise<Message> {
  const alsoSaid = alsoSaidIn(options);
  const { location, kind } = options;
  if (location) {
    // A place is the SDK's shape, not one written out here: ours said less than its does — no time, no
    // asset, and none of the plain text a client that knows nothing of places falls back to.
    const asTheSdkMakesIt = ContentHelpers.makeLocationContent(
      body,
      `geo:${location.latitude},${location.longitude}`,
      Date.now(),
      location.description,
      LocationAssetType.Self
    );
    // `msgtype` said again by name: the helper declares it a plain string, and a plain string is what takes
    // the whole thing out of the union the SDK checks what is sent against.
    // `info` is the thumbnail of the map, which a place shared from here does not have. The spec has it
    // optional and the SDK has it required, so it goes empty: every client reads `info?.thumbnail_url` and
    // finds nothing either way, and what is sent is checked instead of asserted.
    const place = {
      ...asTheSdkMakesIt,
      ...alsoSaid,
      info: {},
      msgtype: MsgType.Location as const
    };
    return sendWithTransaction(client, conversationId, place, options.transactionId, () =>
      client.sendMessage(conversationId, place, options.transactionId)
    );
  }
  /**
   * Built here rather than asked of `ContentHelpers.makeTextMessage` and its html cousins, which make exactly
   * these three.
   *
   * Those are declared as returning the whole `RoomMessageEventContent` union, and spreading a union to add
   * the mentions and the relation gives every key not shared by every member the type `never`, which nothing
   * accepts. Using them means asserting the result back into shape, and an assertion is a lie the compiler
   * stops checking. So each goes out as one member of the sdk's own union, named, and the sdk checks it.
   */
  const sent = (content: RoomMessageEventContent) =>
    sendWithTransaction(client, conversationId, content, options.transactionId, () =>
      client.sendMessage(conversationId, content, options.transactionId)
    );
  if (kind === "action") return sent({ msgtype: MsgType.Emote, body, ...alsoSaid });
  if (kind === "notice") return sent({ msgtype: MsgType.Notice, body, ...alsoSaid });
  return sent({ msgtype: MsgType.Text, body, ...alsoSaid });
}

/** A thread answer carries the thread it belongs to, and a plain answer only points at the message. */
function relationFor(replyToId: string | undefined, threadId: string | undefined) {
  if (threadId) {
    return {
      rel_type: RelationType.Thread,
      event_id: threadId,
      is_falling_back: replyToId === undefined,
      "m.in_reply_to": { event_id: replyToId ?? threadId }
    };
  }
  return replyToId ? { "m.in_reply_to": { event_id: replyToId } } : undefined;
}

/**
 * Sends room content, tolerating a retry with a transaction id already used in this session.
 * matrix-js-sdk refuses to queue a second event with a known transaction id, so a previous attempt is
 * resent when it failed and reused when it already succeeded. The transaction id is kept on the returned
 * message so callers can match it against their local echo.
 */
export async function sendWithTransaction(
  client: MatrixClient,
  conversationId: ConversationId,
  content: SentContent,
  transactionId: string | undefined,
  /**
   * How this goes out. Handed in rather than worked out here from a flag beside the content: a flag and the
   * thing it describes are two places to say one thing, and nothing keeps them agreeing. Whoever built the
   * content is the only one who knows what it is, so they say it once, by choosing this.
   */
  send: () => Promise<{ event_id: string }>
): Promise<Message> {
  // The room may not be in the local store yet, right after creating it, and sending does not need it.
  const room = client.getRoom(conversationId);
  // An application that painted from what it had can be told to say something before that conversation has
  // caught up, and locking a message needs its state. Waiting costs nothing once it is there.
  // Waiting for the conversation to say how it is encrypted is not possible beforehand: a conversation that
  // has not caught up and one that simply is not encrypted look exactly the same. The failure is the only
  // signal there is, so it is recovered from rather than predicted.
  if (room) await waitUntilRoomIsUsable(room).catch(() => undefined);
  const pending = room && transactionId ? room.getEventForTxnId(transactionId) : undefined;
  const eventId = pending
    ? await resolvePendingEvent(client, room!, pending)
    : (await sendOnce(client, conversationId, send)).event_id;
  const message = await mapSentEvent(client, conversationId, eventId, content);
  return transactionId ? { ...message, transactionId } : message;
}

/**
 * Maps the event that was just sent. The timeline copy is preferred because it carries the server timestamp,
 * but it may be missing or still encrypted, so the content that was sent is used as a fallback. Reporting a
 * failure for a message the homeserver already accepted would make the caller send it twice.
 */
async function mapSentEvent(
  client: MatrixClient,
  conversationId: ConversationId,
  eventId: string,
  content: SentContent
): Promise<Message> {
  const event = client.getRoom(conversationId)?.findEventById(eventId);
  if (event?.isEncrypted()) await client.decryptEventIfNeeded(event);
  const fromTimeline = event ? mapMessage(event) : undefined;
  if (fromTimeline) return fromTimeline;
  const local = mapMessage(
    new MatrixEvent({
      type: EventType.RoomMessage,
      event_id: eventId,
      sender: client.getSafeUserId(),
      room_id: conversationId,
      origin_server_ts: Date.now(),
      content
    })
  );
  if (!local) throw new Error("Matrix did not return the sent message");
  return local;
}

async function resolvePendingEvent(client: MatrixClient, room: Room, pending: MatrixEvent): Promise<string> {
  if (pending.status === EventStatus.NOT_SENT) {
    return (await client.resendEvent(pending, room)).event_id;
  }
  const eventId = pending.getId();
  // A local echo id means the previous attempt is still in flight and has no server id yet.
  if (!eventId || eventId.startsWith("~")) {
    throw new Error("A previous send with the same transaction id is still in flight");
  }
  return eventId;
}
