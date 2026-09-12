import {
  RelationType, ClientEvent, EventStatus, EventType, MatrixEvent, MsgType, type MatrixClient, type Room } from "matrix-js-sdk";
import type { RoomMessageEventContent } from "matrix-js-sdk/lib/@types/events.js";
import type { Conversation, ConversationId, CreateConversationInput, Message, MessagePage, SendContent,
  MessageKind
} from "@relaykit/core";
import { mapConversation, mapMessage, mapMessages } from "./matrix-mapper.js";
import { createMatrixConversation, joinMatrixConversation } from "./matrix-conversations.js";
import { listMatrixMessages } from "./matrix-timeline.js";

export function listMatrixConversations(client: MatrixClient): readonly Conversation[] {
  const conversations: Conversation[] = [];
  for (const room of client.getRooms()) {
    // A space groups conversations, so it is not one of them.
    const isSpace = room.isSpaceRoom();
    if (isSpace) continue;
    if (room.getMyMembership() === "join" || room.getMyMembership() === "invite") {
      conversations.push(mapConversation(room));
    }
  }
  return conversations;
}

export function createConversation(client: MatrixClient, input: CreateConversationInput): Promise<Conversation> {
  return createMatrixConversation(client, input);
}

export function joinConversation(
  client: MatrixClient,
  conversationId: ConversationId,
  via: readonly string[] = []
): Promise<Conversation> {
  return joinMatrixConversation(client, conversationId, via);
}

export async function loadMoreMessages(
  client: MatrixClient,
  conversationId: ConversationId,
  limit: number
): Promise<MessagePage> {
  const room = client.getRoom(conversationId);
  if (!room) return { messages: [], hasMore: false };
  const hasMore = await client.paginateEventTimeline(room.getLiveTimeline(), { backwards: true, limit });
  return { messages: await listMatrixMessages(client, conversationId), hasMore };
}

/**
 * Resolves the room, waiting for sync to deliver it if needed. A client that started from its local cache
 * does not know a room created moments ago on another device.
 */
export function waitForRoom(client: MatrixClient, conversationId: ConversationId, timeoutMs = 10000): Promise<Room> {
  const known = client.getRoom(conversationId);
  if (known) return Promise.resolve(known);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      client.removeListener(ClientEvent.Room, onRoom);
    };
    const onRoom = (room: Room) => {
      if (room.roomId !== conversationId) return;
      cleanup();
      resolve(room);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("The conversation is not available yet"));
    }, timeoutMs);
    client.on(ClientEvent.Room, onRoom);
  });
}

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

async function waitUntilEncryptionIsKnown(client: MatrixClient, roomId: string, timeoutMs = 10000): Promise<void> {
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
  content: RoomMessageEventContent,
  transactionId: string | undefined,
  eventType?: EventType
): Promise<{ event_id: string }> {
  // La sobrecarga de `sendEvent` ata el contenido al tipo de evento, y aqui el tipo se decide en tiempo de
  // ejecucion. La forma sigue el spec: una pegatina lleva body, info y url, como un adjunto de imagen.
  const sendAsItsOwnType = () => {
    const sendTyped = client.sendEvent.bind(client) as
      (roomId: string, type: string, body: unknown, txnId?: string) => Promise<{ event_id: string }>;
    return sendTyped(conversationId, eventType as string, content, transactionId);
  };
  const send = () => (eventType ? sendAsItsOwnType() : client.sendMessage(conversationId, content, transactionId));
  try {
    return await send();
  } catch (error) {
    if (!isEncryptionNotHereYet(error)) throw error;
    await waitUntilEncryptionIsKnown(client, conversationId);
    return send();
  }
}

export async function waitUntilRoomIsUsable(room: Room, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const isJoined = room.getMyMembership() === "join";
    const hasState = room.currentState.getStateEvents(EventType.RoomCreate, "") !== null;
    if (isJoined && hasState) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("The conversation is not ready yet");
}

const messageTypes: Partial<Record<MessageKind, MsgType>> = { action: MsgType.Emote, notice: MsgType.Notice };

export function sendMessage(
  client: MatrixClient,
  conversationId: ConversationId,
  body: string,
  options: SendContent = {}
): Promise<Message> {
  const { formattedBody, mentions, kind, location } = options;
  const content = {
    msgtype: location ? MsgType.Location : messageTypes[kind ?? "action"] && kind ? messageTypes[kind] : MsgType.Text,
    body,
    // A place is said twice: as a geo URI every client understands, and as the pieces newer ones prefer.
    ...(location ? {
      geo_uri: `geo:${location.latitude},${location.longitude}`,
      "org.matrix.msc3488.location": {
        uri: `geo:${location.latitude},${location.longitude}`,
        ...(location.description ? { description: location.description } : {})
      }
    } : {}),
    ...(formattedBody ? { format: "org.matrix.custom.html", formatted_body: formattedBody } : {}),
    ...(mentions ? { "m.mentions": {
      ...(mentions.userIds ? { user_ids: [...mentions.userIds] } : {}),
      ...(mentions.everyone ? { room: true } : {})
    } } : {}),
    ...(relationFor(options.replyToId, options.threadId) ?? {})
  } as RoomMessageEventContent;
  return sendWithTransaction(client, conversationId, content, options.transactionId);
}

/** A thread answer carries the thread it belongs to, and a plain answer only points at the message. */
function relationFor(replyToId: string | undefined, threadId: string | undefined): object | undefined {
  if (threadId) {
    return {
      "m.relates_to": {
        rel_type: RelationType.Thread,
        event_id: threadId,
        is_falling_back: replyToId === undefined,
        "m.in_reply_to": { event_id: replyToId ?? threadId }
      }
    };
  }
  return replyToId ? { "m.relates_to": { "m.in_reply_to": { event_id: replyToId } } } : undefined;
}

export async function listMatrixThread(
  client: MatrixClient,
  conversationId: ConversationId,
  rootId: string
): Promise<readonly Message[]> {
  const { events } = await client.relations(conversationId, rootId, RelationType.Thread, null, {});
  for (const event of events) {
    if (event.isEncrypted()) await client.decryptEventIfNeeded(event);
  }
  return mapMessages(events);
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
  content: RoomMessageEventContent,
  transactionId: string | undefined,
  /** Lo que no es un mensaje corriente tiene su propio tipo de evento. Una pegatina es `m.sticker`. */
  eventType?: EventType
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
    : (await sendOnce(client, conversationId, content, transactionId, eventType)).event_id;
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
  content: RoomMessageEventContent
): Promise<Message> {
  const event = client.getRoom(conversationId)?.findEventById(eventId);
  if (event?.isEncrypted()) await client.decryptEventIfNeeded(event);
  const fromTimeline = event ? mapMessage(event) : undefined;
  if (fromTimeline) return fromTimeline;
  const local = mapMessage(new MatrixEvent({
    type: EventType.RoomMessage,
    event_id: eventId,
    sender: client.getSafeUserId(),
    room_id: conversationId,
    origin_server_ts: Date.now(),
    content
  }));
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

/**
 * The homeserver can only search what it can read, so encrypted conversations are invisible to it. Whatever
 * it does find still comes back mapped like any other message.
 */
export async function searchMatrixMessages(client: MatrixClient, query: string): Promise<readonly Message[]> {
  const response = await client.searchMessageText({ query });
  const results = response.search_categories.room_events?.results ?? [];
  const events = results
    .map(result => result.result)
    .filter((event): event is NonNullable<typeof event> => event !== undefined)
    .map(event => new MatrixEvent(event));
  return mapMessages(events);
}
