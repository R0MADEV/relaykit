import { EventType, KnownMembership, Preset, RoomType, Visibility, type MatrixClient } from "matrix-js-sdk";
import type { Conversation, CreateSpaceInput, Space, SpaceChild } from "@relaykit/core";
import {} from "./matrix-mapper.js";
import { mapConversation } from "./matrix-conversation-mapper.js";

const childEvent = EventType.SpaceChild;

/** A space is a room that holds other rooms instead of messages. */
export function listMatrixSpaces(client: MatrixClient): readonly Space[] {
  return client
    .getRooms()
    .filter(room => room.isSpaceRoom())
    .filter(room => room.getMyMembership() === KnownMembership.Join)
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

export async function addToMatrixSpace(
  client: MatrixClient,
  spaceId: string,
  conversationId: string
): Promise<void> {
  const via = conversationId.split(":")[1];
  await client.sendStateEvent(spaceId, childEvent, { via: via ? [via] : [] }, conversationId);
}

export async function removeFromMatrixSpace(
  client: MatrixClient,
  spaceId: string,
  conversationId: string
): Promise<void> {
  await client.sendStateEvent(spaceId, childEvent, {}, conversationId);
}

export function listMatrixSpaceConversations(client: MatrixClient, spaceId: string): readonly Conversation[] {
  const space = client.getRoom(spaceId);
  if (!space) return [];
  const children = space.currentState
    .getStateEvents(childEvent)
    .filter(event => Array.isArray(event.getContent().via))
    .map(event => event.getStateKey())
    .filter((roomId): roomId is string => roomId !== undefined);
  return children
    .map(roomId => client.getRoom(roomId))
    .filter(room => room !== null)
    .map(room => mapConversation(room));
}

/**
 * What is inside a space, down as many levels as it goes.
 *
 * Asked of the homeserver rather than walked here: a space can hold spaces, those can hold more, and the
 * homeserver is the only one that can see the whole shape without fetching every room on the way.
 *
 * It answers with a flat list, so how deep each one sits is worked out from who points at whom — a tree is
 * what a person reads, and a list of rooms in no order is not one.
 */
export async function listMatrixSpaceChildren(
  client: MatrixClient,
  spaceId: string
): Promise<readonly SpaceChild[]> {
  const { rooms } = await client.getRoomHierarchy(spaceId, 100, 5);
  const pointedAtBy = new Map(rooms.map(room => [room.room_id, room.children_state ?? []]));
  const children: SpaceChild[] = [];
  const seen = new Set([spaceId]);
  let level = [spaceId];
  let depth = 1;
  // Breadth first, so the first time a room is reached is by its shortest way in: a conversation put in two
  // places at once sits where the nearer of them puts it, which is where somebody reading expects to find it.
  while (level.length > 0 && depth <= 5) {
    const next: string[] = [];
    for (const parent of level) {
      const pointing = [...(pointedAtBy.get(parent) ?? [])].sort(orderedBy);
      for (const pointer of pointing) {
        const childId = pointer.state_key;
        if (seen.has(childId)) continue;
        seen.add(childId);
        next.push(childId);
        const named = rooms.find(room => room.room_id === childId);
        children.push({
          conversationId: childId,
          depth,
          ...(named?.name ? { title: named.name } : {}),
          ...(pointer.content.suggested ? { suggested: true } : {})
        });
      }
    }
    level = next;
    depth += 1;
  }
  return children;
}

/**
 * The order a space puts its children in, which is the space's own choice and not this library's.
 *
 * Those given an order come first and in it; the rest fall back to their id, which is at least the same on
 * every device rather than whatever order the homeserver happened to answer in.
 */
function orderedBy(
  one: { readonly state_key: string; readonly content: { readonly order?: string } },
  other: { readonly state_key: string; readonly content: { readonly order?: string } }
): number {
  const mine = one.content.order ?? "";
  const theirs = other.content.order ?? "";
  if (mine !== theirs) return mine === "" ? 1 : theirs === "" ? -1 : mine.localeCompare(theirs);
  return one.state_key.localeCompare(other.state_key);
}
