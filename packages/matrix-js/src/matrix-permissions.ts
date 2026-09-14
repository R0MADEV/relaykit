import { EventType, KnownMembership, type MatrixClient, type Membership } from "matrix-js-sdk";
import type {
  ConversationPermissions,
  ConversationRole,
  Participant,
  ParticipantMembership
} from "@relaykit/core";
import { waitForRoom } from "./matrix-room-operations.js";

const roleLevels: Record<ConversationRole, number> = { member: 0, moderator: 50, admin: 100 };

/** Turns the levels Matrix uses into the plain questions an interface actually asks. */
export async function readMatrixPermissions(
  client: MatrixClient,
  conversationId: string
): Promise<ConversationPermissions> {
  const room = await waitForRoom(client, conversationId);
  const state = room.currentState;
  const level = state.getMember(client.getSafeUserId())?.powerLevel ?? 0;
  return {
    canSend: state.maySendMessage(client.getSafeUserId()),
    canInvite: state.hasSufficientPowerLevelFor("invite", level),
    canRemove: state.hasSufficientPowerLevelFor("kick", level),
    canBan: state.hasSufficientPowerLevelFor("ban", level),
    canRename: state.maySendStateEvent(EventType.RoomName, client.getSafeUserId())
  };
}

export async function setMatrixRole(
  client: MatrixClient,
  conversationId: string,
  userId: string,
  role: ConversationRole
): Promise<void> {
  await client.setPowerLevel(conversationId, userId, roleLevels[role]);
}

/**
 * Everybody the conversation knows about and what each of them is in it.
 *
 * Whether somebody can be acted on is worked out here rather than handed out as a number: Matrix says nobody
 * may remove, ban or re-rank somebody at or above their own level, and a screen that has to know that is a
 * screen that has to know about power levels.
 */
export async function listMatrixParticipants(
  client: MatrixClient,
  conversationId: string
): Promise<readonly Participant[]> {
  const room = await waitForRoom(client, conversationId);
  const state = room.currentState;
  const mine = state.getMember(client.getSafeUserId())?.powerLevel ?? 0;
  return state
    .getMembers()
    .map(member => ({
      userId: member.userId,
      role: roleOf(member.powerLevel),
      membership: membershipOf(member.membership),
      isUnderMe: member.powerLevel < mine
    }))
    .filter(participant => participant.membership !== KnownMembership.Leave);
}

function roleOf(level: number): ConversationRole {
  if (level >= roleLevels.admin) return "admin";
  if (level >= roleLevels.moderator) return "moderator";
  return "member";
}

/**
 * Anything the homeserver says that the SDK does not know is somebody who is not there.
 *
 * The names are the SDK's own, not a list written out again here: `Membership` is deliberately wider than
 * the five, because a homeserver may say something nobody has heard of yet.
 */
function membershipOf(said: Membership | undefined): ParticipantMembership {
  const known: readonly ParticipantMembership[] = Object.values(KnownMembership);
  return known.find(each => each === said) ?? KnownMembership.Leave;
}
