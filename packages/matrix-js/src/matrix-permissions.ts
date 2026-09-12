import { EventType, type MatrixClient } from "matrix-js-sdk";
import type { ConversationPermissions, ConversationRole } from "@relaykit/core";
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
