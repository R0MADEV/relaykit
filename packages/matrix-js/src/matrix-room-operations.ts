import { ClientEvent, EventStatus, EventType, MatrixEvent, MsgType, type MatrixClient, type Room } from "matrix-js-sdk";
import type { RoomMessageEventContent } from "matrix-js-sdk/lib/@types/events.js";
import type { Conversation, ConversationId, CreateConversationInput, Message, MessagePage } from "@relaykit/core";
import { mapConversation, mapMessage } from "./matrix-mapper.js";
import { createMatrixConversation, joinMatrixConversation } from "./matrix-conversations.js";
import { listMatrixMessages } from "./matrix-timeline.js";

export function listMatrixConversations(client: MatrixClient): readonly Conversation[] {
  const conversations: Conversation[] = [];
  for (const room of client.getRooms()) {
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

export function sendMessage(
  client: MatrixClient,
  conversationId: ConversationId,
  body: string,
  transactionId?: string,
  replyToId?: string
): Promise<Message> {
  const content = {
    msgtype: MsgType.Text,
    body,
    ...(replyToId ? { "m.relates_to": { "m.in_reply_to": { event_id: replyToId } } } : {})
  } as RoomMessageEventContent;
  return sendWithTransaction(client, conversationId, content, transactionId);
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
  transactionId: string | undefined
): Promise<Message> {
  // The room may not be in the local store yet, right after creating it, and sending does not need it.
  const room = client.getRoom(conversationId);
  const pending = room && transactionId ? room.getEventForTxnId(transactionId) : undefined;
  const eventId = pending
    ? await resolvePendingEvent(client, room!, pending)
    : (await client.sendMessage(conversationId, content, transactionId)).event_id;
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
    type: "m.room.message",
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
