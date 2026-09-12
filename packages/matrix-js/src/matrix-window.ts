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
  const oneConversation = { timeline_limit: 20, required_state: stateForOneConversation };
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

async function waitUntilTheRoomArrives(
  client: MatrixClient,
  conversationId: string,
  timeoutMs = 15000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (client.getRoom(conversationId)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function listOf(size: number): {
  ranges: [number, number][];
  timeline_limit: number;
  required_state: [string, string][];
} {
  return {
    ranges: [[0, size - 1]],
    timeline_limit: 20,
    // Enough state to say what a conversation is and who is in it, which is what a list shows.
    required_state: stateForAList
  };
}

/** Enough to say what a conversation is and whether it is encrypted. Who is in it is asked for separately. */
const whatAConversationIs: [string, string][] = [
  // Without this a conversation arrives looking unfinished, and anything that waits for it to be usable waits
  // for ever: being usable means being joined and having been created.
  [EventType.RoomCreate, ""],
  [EventType.RoomName, ""],
  [EventType.RoomTopic, ""],
  [EventType.RoomAvatar, ""],
  [EventType.RoomCanonicalAlias, ""],
  [EventType.RoomJoinRules, ""],
  [EventType.RoomEncryption, ""],
  // Who may do what. Permissions are read off this, and so is whether somebody may say they are on a call;
  // without it a client works those out from nothing and gets them wrong.
  [EventType.RoomPowerLevels, ""],
  // Whether a conference is going on in it, and who is on it. A window brings only the state it is asked
  // for, and without these the SDK's own session sees an empty room: nobody's screen rings, and whoever
  // joined never sees their own membership come back, so the key that is made once it does never is. Both
  // names, because the SDK writes the older one today and already declares the settled one.
  [EventType.GroupCallMemberPrefix, "*"],
  [EventType.RTCMembership, "*"]
];

/**
 * A list shows many conversations at once, so asking for every member of every one of them is asking the
 * homeserver for a great deal that nothing on the screen uses. `$LAZY` is what Matrix has for exactly this:
 * the people who show up in what is being shown, and no more.
 */
const stateForAList: [string, string][] = [
  ...whatAConversationIs,
  [EventType.RoomMember, "$ME"],
  [EventType.RoomMember, "$LAZY"]
];

/**
 * A conversation that is being used is a different matter: every member of it, because this is where who is
 * in it is asked and answered.
 *
 * It is also what calls depend on, in a way that gives nothing away when it is missing. The SDK looks up the
 * person on the other end to hand over their audio; not finding them, it stops, and the caller is left with a
 * call that says it is connected and cannot be heard.
 */
const stateForOneConversation: [string, string][] = [...whatAConversationIs, [EventType.RoomMember, "*"]];
