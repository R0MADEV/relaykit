import { EventType, type MatrixClient, type Room } from "matrix-js-sdk";
import { waitForRoom } from "./matrix-room-operations.js";
import type { Conversation, CreateConversationInput } from "@relaykit/core";
import { mapConversation } from "./matrix-mapper.js";

export async function createMatrixConversation(
  client: MatrixClient,
  input: CreateConversationInput
): Promise<Conversation> {
  const roomOptions = {
    invite: [...input.participantIds],
    ...(input.direct ? { is_direct: true } : {}),
    initial_state: input.encrypted === false
      ? []
      : [{
          type: EventType.RoomEncryption,
          state_key: "",
          content: { algorithm: "m.megolm.v1.aes-sha2" }
        }],
    ...(input.title ? { name: input.title } : {})
  };
  const response = await client.createRoom(roomOptions);
  if (input.direct) await markAsDirect(client, response.room_id, input.participantIds);
  const room = client.getRoom(response.room_id);
  if (room) {
    return mapConversation(room);
  }

  return {
    id: response.room_id,
    participantIds: [...input.participantIds],
    ...(input.title ? { title: input.title } : {})
  };
}

/** Records the room in the `m.direct` account data, which is how Matrix clients recognise direct chats. */
async function markAsDirect(client: MatrixClient, roomId: string, participantIds: readonly string[]): Promise<void> {
  const current = client.getAccountData(EventType.Direct)?.getContent<Record<string, string[]>>() ?? {};
  const updated: Record<string, string[]> = { ...current };
  for (const participantId of participantIds) {
    const rooms = updated[participantId] ?? [];
    if (!rooms.includes(roomId)) updated[participantId] = [...rooms, roomId];
  }
  await client.setAccountData(EventType.Direct, updated);
}

export function isDirectRoom(room: Room): boolean {
  if (room.getDMInviter() !== undefined) return true;
  const directMap = room.client.getAccountData(EventType.Direct)?.getContent<Record<string, string[]>>() ?? {};
  return Object.values(directMap).some(rooms => rooms.includes(room.roomId));
}

export async function leaveMatrixConversation(client: MatrixClient, conversationId: string): Promise<void> {
  await client.leave(conversationId);
  // Forgetting drops the local copy of a room the user is no longer part of.
  await client.forget(conversationId).catch(() => undefined);
}

export async function inviteToMatrixConversation(
  client: MatrixClient,
  conversationId: string,
  userId: string
): Promise<Conversation> {
  await client.invite(conversationId, userId);
  const conversation = mapConversation(await waitForRoom(client, conversationId));
  // The membership arrives through sync, so the invited user is added to what the caller gets back.
  const participantIds = conversation.participantIds.includes(userId)
    ? conversation.participantIds
    : [...conversation.participantIds, userId];
  return { ...conversation, participantIds };
}

export async function renameMatrixConversation(
  client: MatrixClient,
  conversationId: string,
  title: string
): Promise<Conversation> {
  await client.setRoomName(conversationId, title);
  const room = await waitForRoom(client, conversationId);
  // The name arrives through sync, so the state event just sent may not be reflected yet.
  return { ...mapConversation(room), title };
}

export async function joinMatrixConversation(
  client: MatrixClient,
  conversationId: string
): Promise<Conversation> {
  await client.joinRoom(conversationId);
  const room = client.getRoom(conversationId);
  if (!room) {
    throw new Error("Matrix did not return the joined conversation");
  }
  return mapConversation(room);
}
