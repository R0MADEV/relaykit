import { EventType, type MatrixClient, type MatrixEvent } from "matrix-js-sdk";
import type { ConversationId, PastCall, UserId } from "@relaykit/core";
import { waitForRoom } from "./matrix-room-operations.js";

/** The two names a call membership is written under while the settled one is still a proposal. */
const membershipEventTypes: string[] = [EventType.GroupCallMemberPrefix, EventType.RTCMembership];

/**
 * The calls of a conversation that are over, read back out of the conversation itself.
 *
 * Joining a call writes a membership into the room and leaving takes it back out, and the room keeps both.
 * So a call is the stretch between the first person walking in and the last one walking out, and that is
 * the same for everybody — including somebody opening the application on a device that was switched off
 * while it happened. Nothing here is remembered locally.
 */
export async function listMatrixPastCalls(
  client: MatrixClient,
  conversationId: ConversationId,
  limit: number
): Promise<readonly PastCall[]> {
  const room = await waitForRoom(client, conversationId);
  const changes = room
    .getLiveTimeline()
    .getEvents()
    .filter(event => membershipEventTypes.includes(event.getType()))
    .sort((left, right) => left.getTs() - right.getTs());

  const over: PastCall[] = [];
  const inTheCall = new Set<string>();
  let startedAt: number | undefined;
  let wereOnIt: UserId[] = [];

  for (const change of changes) {
    const whose = change.getStateKey();
    if (whose === undefined) continue;
    if (isIn(change)) {
      if (inTheCall.size === 0) {
        startedAt = change.getTs();
        wereOnIt = [];
      }
      inTheCall.add(whose);
      const who = change.getSender();
      if (who && !wereOnIt.includes(who)) wereOnIt.push(who);
      continue;
    }
    inTheCall.delete(whose);
    // The last one out is what ends it. Until then somebody is still on the call and it is not over.
    if (inTheCall.size > 0 || startedAt === undefined) continue;
    over.push({
      id: `${conversationId}#${startedAt}`,
      conversationId,
      startedAt,
      endedAt: change.getTs(),
      participantIds: wereOnIt
    });
    startedAt = undefined;
  }

  return over.reverse().slice(0, limit);
}

/** A membership with anything in it says somebody is on the call; emptied, it says they have gone. */
function isIn(change: MatrixEvent): boolean {
  return Object.keys(change.getContent() ?? {}).length > 0;
}
