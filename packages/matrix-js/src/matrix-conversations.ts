import { EventType, Preset, Visibility, type MatrixClient, type Room } from "matrix-js-sdk";
import { waitForRoom, waitUntilRoomIsUsable } from "./matrix-room-operations.js";
import type { Conversation, CreateConversationInput } from "@relaykit/core";
import { mapConversation } from "./matrix-mapper.js";

export async function createMatrixConversation(
  client: MatrixClient,
  input: CreateConversationInput
): Promise<Conversation> {
  const roomOptions = {
    invite: [...input.participantIds],
    ...(input.public ? { preset: Preset.PublicChat, visibility: Visibility.Public } : {}),
    ...(input.direct ? { is_direct: true } : {}),
    // El cifrado en Matrix solo se puede sumar, nunca restar: quien llama puede forzarlo mandando este evento,
    // pero no puede impedir que el homeserver lo anada por politica, y una vez puesto en una sala es para
    // siempre. Asi que solo se pide cuando se pide expresamente; el resto de las veces decide el operador,
    // que es quien tiene el contexto legal y de soporte y quien ya configura
    // `encryption_enabled_by_default_for_room_type` en su homeserver.
    ...(input.encrypted === true
      ? {
          initial_state: [{
            type: EventType.RoomEncryption,
            state_key: "",
            content: { algorithm: "m.megolm.v1.aes-sha2" }
          }]
        }
      : {}),
    ...(input.title ? { name: input.title } : {})
  };
  const response = await client.createRoom(roomOptions);
  if (input.direct) await markAsDirect(client, response.room_id, input.participantIds);
  // Esperar al estado antes de describirla. Contestar en cuanto el homeserver acepta devuelve una conversacion
  // a medio saber: sin membresia, sin regla de entrada y, lo que mas importa, sin saber si esta cifrada. Y
  // sobre eso ultimo nadie debe suponer, porque el cifrado no se puede quitar despues.
  const room = await waitForRoom(client, response.room_id);
  await waitUntilRoomIsUsable(room);
  // Si esta cifrada se le pregunta al servidor en vez de esperar a que lo cuente la sincronizacion, que llega
  // despues. Sobre esto no se puede suponer ni contestar "todavia no se": el cifrado no se puede quitar, y
  // quien crea una conversacion para que soporte pueda leerla necesita saberlo en ese momento, no mas tarde.
  return { ...mapConversation(room), isEncrypted: await isEncryptedOnTheServer(client, response.room_id) };
}

async function isEncryptedOnTheServer(client: MatrixClient, conversationId: string): Promise<boolean> {
  const state = await client.getStateEvent(conversationId, EventType.RoomEncryption, "").catch(() => undefined);
  return typeof state?.algorithm === "string";
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
  conversationId: string,
  via: readonly string[] = []
): Promise<Conversation> {
  // Without a hint the homeserver has no way to find a conversation it does not already know.
  await client.joinRoom(conversationId, via.length > 0 ? { viaServers: [...via] } : {});
  const room = await waitForRoom(client, conversationId);
  await waitUntilRoomIsUsable(room);
  return mapConversation(room);
}

/** Removing, banning and lifting a ban are the same kind of change, only with a different verb. */
export async function changeMatrixMembership(
  client: MatrixClient,
  conversationId: string,
  userId: string,
  action: "kick" | "ban" | "unban",
  reason?: string
): Promise<Conversation> {
  if (action === "kick") await client.kick(conversationId, userId, reason);
  if (action === "ban") await client.ban(conversationId, userId, reason);
  if (action === "unban") await client.unban(conversationId, userId);
  const room = await waitForRoom(client, conversationId);
  const conversation = mapConversation(room);
  const isStillListed = action !== "unban" && conversation.participantIds.includes(userId);
  // The membership change reaches the room through sync, so the answer reflects it right away.
  return isStillListed
    ? { ...conversation, participantIds: conversation.participantIds.filter(participant => participant !== userId) }
    : conversation;
}

const favouriteTag = "m.favourite";

export async function setMatrixFavourite(
  client: MatrixClient,
  conversationId: string,
  favourite: boolean
): Promise<Conversation> {
  if (favourite) await client.setRoomTag(conversationId, favouriteTag, {});
  else await client.deleteRoomTag(conversationId, favouriteTag);
  const conversation = mapConversation(await waitForRoom(client, conversationId));
  return favourite ? { ...conversation, isFavourite: true } : conversation;
}
