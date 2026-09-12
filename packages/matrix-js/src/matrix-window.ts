import { EventType, type MatrixClient } from "matrix-js-sdk";
import { SlidingSync } from "matrix-js-sdk/lib/sliding-sync.js";

/**
 * A window over the conversations, most recent first. Without it the homeserver sends every room on the way in,
 * which on an account with thousands of them is the difference between opening at once and waiting.
 *
 * `SlidingSync` is not on the public surface of `matrix-js-sdk`, so it is reached by its own path. It speaks
 * the simplified sliding sync that Synapse serves.
 */
export interface ConversationWindow {
  readonly sliding: SlidingSync;
  readonly widen: (upTo: number) => Promise<void>;
  /** Asks the homeserver for one conversation the window does not hold, and waits for it to arrive. */
  readonly reach: (conversationId: string) => Promise<void>;
}

const listName = "conversations";

export function openTheWindow(client: MatrixClient, size: number): ConversationWindow {
  let held = Math.max(size, 1);
  const lists = new Map([[listName, listOf(held)]]);
  // What to ask for about one conversation reached for on its own. The homeserver refuses a subscription that
  // does not say which state it wants.
  const oneConversation = { timeline_limit: 20, required_state: stateWorthHaving };
  const sliding = new SlidingSync(client.baseUrl, lists, oneConversation, client, 30000);

  const reachedFor = new Set<string>();

  return {
    sliding,
    reach: async (conversationId: string) => {
      if (client.getRoom(conversationId) || reachedFor.has(conversationId)) return;
      reachedFor.add(conversationId);
      sliding.modifyRoomSubscriptions(new Set(reachedFor));
      await waitUntilTheRoomArrives(client, conversationId);
    },
    widen: async (upTo: number) => {
      if (upTo <= held) return;
      held = upTo;
      await sliding.setList(listName, listOf(held));
      // Asking for a wider window and the wider window arriving are not the same moment, and whoever asked for
      // more conversations is waiting for them.
      await waitUntilTheWindowHolds(client, upTo);
    }
  };
}

/** Stops as soon as there are enough, or when the account simply has no more to give. */
async function waitUntilTheWindowHolds(client: MatrixClient, upTo: number, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let seen = client.getRooms().length;
  let unchangedFor = 0;
  while (Date.now() < deadline && client.getRooms().length < upTo) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const now = client.getRooms().length;
    unchangedFor = now === seen ? unchangedFor + 1 : 0;
    seen = now;
    // Nothing new for a while means the account has no more conversations, not that they are slow.
    if (unchangedFor > 30) return;
  }
}

async function waitUntilTheRoomArrives(client: MatrixClient, conversationId: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (client.getRoom(conversationId)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function listOf(size: number): { ranges: [number, number][]; timeline_limit: number; required_state: [string, string][] } {
  return {
    ranges: [[0, size - 1]],
    timeline_limit: 20,
    // Enough state to say what a conversation is and who is in it, which is what a list shows.
    required_state: stateWorthHaving
  };
}

/** Enough to say what a conversation is, who is in it and whether it is encrypted. */
const stateWorthHaving: [string, string][] = [
  [EventType.RoomName, ""],
  [EventType.RoomTopic, ""],
  [EventType.RoomAvatar, ""],
  [EventType.RoomCanonicalAlias, ""],
  [EventType.RoomJoinRules, ""],
  [EventType.RoomEncryption, ""],
  [EventType.RoomMember, "$ME"]
];
