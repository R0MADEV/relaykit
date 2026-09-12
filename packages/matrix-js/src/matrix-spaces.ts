import { EventType, Preset, RoomType, Visibility, type MatrixClient } from "matrix-js-sdk";
import type { Conversation, CreateSpaceInput, Space } from "@relaykit/core";
import { mapConversation } from "./matrix-mapper.js";

const childEvent = EventType.SpaceChild;

/** A space is a room that holds other rooms instead of messages. */
export function listMatrixSpaces(client: MatrixClient): readonly Space[] {
  return client.getRooms()
    .filter(room => room.isSpaceRoom())
    .filter(room => room.getMyMembership() === "join")
    .map(room => ({ id: room.roomId, ...(room.name ? { title: room.name } : {}) }));
}

export async function createMatrixSpace(client: MatrixClient, input: CreateSpaceInput): Promise<Space> {
  const response = await client.createRoom({
    name: input.title,
    preset: Preset.PrivateChat,
    visibility: Visibility.Private,
    creation_content: { type: RoomType.Space }
  });
  return { id: response.room_id, title: input.title };
}

export async function addToMatrixSpace(client: MatrixClient, spaceId: string, conversationId: string): Promise<void> {
  const via = conversationId.split(":")[1];
  await client.sendStateEvent(spaceId, childEvent, { via: via ? [via] : [] }, conversationId);
}

export async function removeFromMatrixSpace(client: MatrixClient, spaceId: string, conversationId: string): Promise<void> {
  await client.sendStateEvent(spaceId, childEvent, {}, conversationId);
}

export function listMatrixSpaceConversations(client: MatrixClient, spaceId: string): readonly Conversation[] {
  const space = client.getRoom(spaceId);
  if (!space) return [];
  const children = space.currentState.getStateEvents(childEvent)
    .filter(event => Array.isArray(event.getContent().via))
    .map(event => event.getStateKey())
    .filter((roomId): roomId is string => roomId !== undefined);
  return children
    .map(roomId => client.getRoom(roomId))
    .filter(room => room !== null)
    .map(room => mapConversation(room));
}

