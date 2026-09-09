import type { MatrixClient } from "matrix-js-sdk";
import type { ConversationId, Message } from "@relaykit/core";
import { mapMessages } from "./matrix-mapper.js";

export async function listMatrixMessages(
  client: MatrixClient,
  conversationId: ConversationId
): Promise<readonly Message[]> {
  const room = client.getRoom(conversationId);
  if (!room) {
    return [];
  }

  const events = room.getLiveTimeline().getEvents();
  for (const event of events) {
    if (event.isEncrypted()) {
      await client.decryptEventIfNeeded(event);
    }
  }
  return mapMessages(events);
}
