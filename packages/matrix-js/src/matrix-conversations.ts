import { EventType, JoinRule, Preset, Visibility, type MatrixClient, type Room } from "matrix-js-sdk";
import { waitForRoom, waitUntilRoomIsUsable } from "./matrix-room-operations.js";
import type { Conversation, CreateConversationInput } from "@relaykit/core";
import {} from "./matrix-mapper.js";
import { mapConversation } from "./matrix-conversation-mapper.js";

/**
 * Which events anybody in the conversation may send, and which take an admin.
 *
 * Being on a call is written into the room as state, and a room's defaults let only admins write state. Left
 * alone, whoever made the conversation could join its conference and nobody else could: the room answered
 * them with a 403, the SDK gave up in the background, and to everybody else they were never there. So the
 * two names a call membership is written under are open to everybody, the way saying something is.
 *
 * Naming any event here replaces the whole default list, so what the defaults protected is said again in
 * full — a room where anybody can hand out power or turn off encryption is not a room.
 */
const whoMaySayWhat: Record<string, number> = {
  [EventType.GroupCallMemberPrefix]: 0,
  [EventType.RTCMembership]: 0,
  [EventType.RoomAvatar]: 50,
  [EventType.RoomCanonicalAlias]: 50,
  [EventType.RoomName]: 50,
  [EventType.RoomEncryption]: 100,
  [EventType.RoomHistoryVisibility]: 100,
  [EventType.RoomPowerLevels]: 100,
  [EventType.RoomServerAcl]: 100,
  [EventType.RoomTombstone]: 100
};

export async function createMatrixConversation(
  client: MatrixClient,
  input: CreateConversationInput
): Promise<Conversation> {
  const roomOptions = {
    invite: [...input.participantIds],
    ...(input.public ? { preset: Preset.PublicChat, visibility: Visibility.Public } : {}),
    ...(input.direct ? { is_direct: true } : {}),
    // Encryption in Matrix can only be added, never taken away: the caller can force it by sending this
    // event, but cannot stop the homeserver adding it by policy, and once on a room it is there for good. So
    // it is only asked for when it is asked for expressly; the rest of the time the operator decides, who has
    // the legal and support context and who already sets `encryption_enabled_by_default_for_room_type`.
    ...(input.encrypted === true
      ? {
          initial_state: [
            {
              type: EventType.RoomEncryption,
              state_key: "",
              content: { algorithm: "m.megolm.v1.aes-sha2" }
            }
          ]
        }
      : {}),
    ...(input.title ? { name: input.title } : {}),
    power_level_content_override: { events: whoMaySayWhat }
  };
  const response = await client.createRoom(roomOptions);
  if (input.direct) await markAsDirect(client, response.room_id, input.participantIds);
  // Waiting for the state before describing it. Answering as soon as the homeserver accepts gives back a
  // half known conversation: no membership, no join rule and, what matters most, no idea whether it is
  // encrypted. And nobody should assume that last one, because encryption cannot be taken off afterwards.
  const room = await waitForRoom(client, response.room_id);
  await waitUntilRoomIsUsable(room);
  await waitUntilItIsWhatWasAskedFor(room, input);
  // Whether it is encrypted is asked of the server rather than waiting for sync to say so, which comes
  // later. This cannot be assumed, nor answered with "not known yet": encryption cannot be taken off, and
  // whoever creates a conversation so support can read it needs to know then, not later.
  return { ...mapConversation(room), isEncrypted: await isEncryptedOnTheServer(client, response.room_id) };
}

/**
 * Waits until the room really is what was asked for.
 *
 * The name and the door went out in the same request as the room itself, and they come back in the same sync
 * — but not necessarily in the same turn as the create event. A conversation handed over before they arrive
 * is called "Empty room" and is shut to everybody, and whoever paints what was handed to them paints that.
 * Nothing here asks the homeserver again: it waits for what is already on its way.
 */
async function waitUntilItIsWhatWasAskedFor(
  room: Room,
  input: CreateConversationInput,
  timeoutMs = 10000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const named = !input.title || room.name === input.title;
    const openToAnybody = !input.public || joinRuleOf(room) === JoinRule.Public;
    if (named && openToAnybody) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  // Not a failure: the conversation exists and is usable. What it is called may simply be slower than this.
}

function joinRuleOf(room: Room): string | undefined {
  const rule: unknown = room.currentState
    .getStateEvents(EventType.RoomJoinRules, "")
    ?.getContent()?.join_rule;
  return typeof rule === "string" ? rule : undefined;
}

async function isEncryptedOnTheServer(client: MatrixClient, conversationId: string): Promise<boolean> {
  const state = await client
    .getStateEvent(conversationId, EventType.RoomEncryption, "")
    .catch(() => undefined);
  return typeof state?.algorithm === "string";
}

/** Records the room in the `m.direct` account data, which is how Matrix clients recognise direct chats. */
async function markAsDirect(
  client: MatrixClient,
  roomId: string,
  participantIds: readonly string[]
): Promise<void> {
  const current = client.getAccountData(EventType.Direct)?.getContent<Record<string, string[]>>() ?? {};
  const updated: Record<string, string[]> = { ...current };
  for (const participantId of participantIds) {
    const rooms = updated[participantId] ?? [];
    if (!rooms.includes(roomId)) updated[participantId] = [...rooms, roomId];
  }
  await client.setAccountData(EventType.Direct, updated);
}

/**
 * Whether a conversation is one person talking to another.
 *
 * Matrix records it twice over, and both are read because each one is missing at a different moment. The
 * account data is the canonical one and belongs to each person separately — the one who starts a direct chat
 * writes their own, the one who accepts writes theirs — but it arrives with the sync, and on a browser
 * restoring a local copy it is among the last things back. A screen reading only that paints every direct
 * chat as a channel until it catches up, with the room's identifier standing in for the name.
 *
 * The invitation that started it says so too, in the room's own state, and that is there from the first
 * moment. Either is proof.
 */
export function isDirectRoom(room: Room): boolean {
  if (room.getDMInviter() !== undefined) return true;
  const directMap =
    room.client.getAccountData(EventType.Direct)?.getContent<Record<string, string[]>>() ?? {};
  if (Object.values(directMap).some(rooms => rooms.includes(room.roomId))) return true;
  return startedAsADirectInvitation(room);
}

/** The `is_direct` the homeserver keeps on the invitation, which is room state and needs no account data. */
function startedAsADirectInvitation(room: Room): boolean {
  const members = room.currentState.getStateEvents(EventType.RoomMember);
  if (!Array.isArray(members)) return false;
  return members.some(member => member.getContent().is_direct === true);
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
  // Read before accepting, because it is the invitation that says so and accepting replaces it.
  const invitedAsADirectBy = client.getRoom(conversationId)?.getDMInviter();
  // Without a hint the homeserver has no way to find a conversation it does not already know.
  await client.joinRoom(conversationId, via.length > 0 ? { viaServers: [...via] } : {});
  const room = await waitForRoom(client, conversationId);
  await waitUntilRoomIsUsable(room);
  // Each person keeps their own list of who they talk to directly, and nobody writes it for them: whoever
  // accepts a direct invitation has to write it down, or their own screen files the chat as a channel as soon
  // as it paints from what was kept rather than from what just happened.
  if (invitedAsADirectBy) await markAsDirect(client, conversationId, [invitedAsADirectBy]);
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
    ? {
        ...conversation,
        participantIds: conversation.participantIds.filter(participant => participant !== userId)
      }
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
