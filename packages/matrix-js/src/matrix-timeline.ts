import { Direction, type MatrixClient, type MatrixEvent } from "matrix-js-sdk";
import type { ConversationId, Message } from "@relaykit/core";
import { mapMessages } from "./matrix-mapper.js";

/** Enough to open a conversation with something to read, when the sync brought none of it. */
const enoughToOpenWith = 20;

export async function listMatrixMessages(
  client: MatrixClient,
  conversationId: ConversationId
): Promise<readonly Message[]> {
  const room = client.getRoom(conversationId);
  if (!room) {
    return [];
  }

  const timeline = room.getLiveTimeline();
  const said = await whatWasSaid(client, timeline.getEvents());
  // A conversation the sync described without any of its talk reads as empty, and it is not: a homeserver
  // that answers with state and no timeline is within its rights. Nothing here can tell an empty conversation
  // from an unfetched one except by asking, and the token says whether there is anything to ask for — so a
  // conversation that really has nothing before it is never asked twice.
  const isMoreBeforeIt = timeline.getPaginationToken(Direction.Backward);
  if (said.length > 0 || !isMoreBeforeIt) return said;
  await client.paginateEventTimeline(timeline, { backwards: true, limit: enoughToOpenWith });
  return whatWasSaid(client, timeline.getEvents());
}

/** What hangs from a thread is read with listThread, not mixed into the conversation. */
async function whatWasSaid(
  client: MatrixClient,
  events: readonly MatrixEvent[]
): Promise<readonly Message[]> {
  for (const event of events) {
    if (event.isEncrypted()) {
      await client.decryptEventIfNeeded(event);
    }
  }
  return mapMessages(events).filter(message => message.threadId === undefined);
}
