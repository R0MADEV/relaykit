import {
  RelationType,
  ClientEvent,
  EventType,
  KnownMembership,
  MatrixEvent,
  type MatrixClient,
  type Room
} from "matrix-js-sdk";

import type {
  Conversation,
  ConversationId,
  CreateConversationInput,
  Message,
  MessagePage
} from "@relaykit/core";
import { mapMessages } from "./matrix-mapper.js";
import { mapConversation } from "./matrix-conversation-mapper.js";
import { createMatrixConversation, joinMatrixConversation } from "./matrix-conversations.js";
import { listMatrixMessages } from "./matrix-timeline.js";

export function listMatrixConversations(client: MatrixClient): readonly Conversation[] {
  const conversations: Conversation[] = [];
  for (const room of client.getRooms()) {
    // A space groups conversations, so it is not one of them.
    const isSpace = room.isSpaceRoom();
    if (isSpace) continue;
    const membership = room.getMyMembership();
    if (membership === KnownMembership.Join || membership === KnownMembership.Invite) {
      conversations.push(mapConversation(room));
    }
  }
  return conversations;
}

export function createConversation(
  client: MatrixClient,
  input: CreateConversationInput
): Promise<Conversation> {
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
export function waitForRoom(
  client: MatrixClient,
  conversationId: ConversationId,
  timeoutMs = 10000
): Promise<Room> {
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

export async function waitUntilRoomIsUsable(room: Room, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const isJoined = room.getMyMembership() === KnownMembership.Join;
    const hasState = room.currentState.getStateEvents(EventType.RoomCreate, "") !== null;
    if (isJoined && hasState) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("The conversation is not ready yet");
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
