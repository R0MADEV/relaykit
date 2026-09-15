/**
 * The list of everything there is to talk in: the channels, and the people.
 *
 * What goes where is decided here rather than by whoever hands the list over, because it is one rule read two
 * ways — a conversation between two people with no name of its own is a person, however it was made.
 */
import type { Conversation, ConversationId, UserId } from "@relaykit/web";
import { face, type People } from "./people.js";
import { element, pressedIn, safe } from "./dom.js";

/**
 * What a conversation is called.
 *
 * A conversation always has a name: where nobody gave it one, the adapter works it out from who is in it,
 * the way the protocol says to. Nothing is invented here on top of that.
 */
/**
 * What to call a conversation on screen.
 *
 * The library says nothing rather than handing over an identifier dressed as a name, so this is where the
 * decision is made: a one-to-one is called by the other person, and anything else falls back to the address
 * it can be reached at. The identifier is the last resort and looks like one, which is honest.
 */
export function titleOf(
  conversation: Conversation,
  where?: { readonly people: People; readonly me: UserId }
): string {
  if (conversation.title) return conversation.title;
  if (where && isBetweenTwo(conversation)) {
    const other = conversation.participantIds.find(participant => participant !== where.me);
    if (other) return where.people.nameOf(other);
  }
  return conversation.alias ?? conversation.id;
}

/** Whether a conversation is one person talking to another, which is a thing the protocol records. */
export function isBetweenTwo(conversation: Conversation): boolean {
  return conversation.isDirect === true;
}

/**
 * One row per person, not one per room.
 *
 * The same two people can end up with several one-to-one rooms — every client that ever opened one made its
 * own — and a list of four rows all called the same name is four rows nobody can tell apart. The most recent
 * is the one that is still being talked in, and `conversations.list` already gives them in that order.
 */
export function onePerPerson(conversations: readonly Conversation[], me: UserId): readonly Conversation[] {
  const seen = new Set<string>();
  return conversations.filter(conversation => {
    const other = conversation.participantIds.find(participant => participant !== me);
    // Nobody else left in it: several of those, all called the same, are leftovers of the same chat and
    // there is nothing on screen to tell them apart by.
    const whoItIsWith = other ?? conversation.title ?? conversation.id;
    if (seen.has(whoItIsWith)) return false;
    seen.add(whoItIsWith);
    return true;
  });
}

/** The channels: everything that is not one person talking to another. */
export function paintChannels(into: HTMLElement, conversations: readonly Conversation[], where: Where): void {
  into.innerHTML = conversations
    .map(conversation => {
      const shut = conversation.joinRule !== "public";
      const name = titleOf(conversation);
      return row(
        conversation,
        where,
        `<span class="hash" aria-hidden="true">${shut ? "🔒" : "#"}</span>
        <span class="name">${safe(name)}</span>`
      );
    })
    .join("");
}

/** The people: one row each, with their face and whether they are about. */
export function paintDirects(into: HTMLElement, conversations: readonly Conversation[], where: Where): void {
  into.innerHTML = conversations
    .map(conversation => {
      const other = conversation.participantIds.find(participant => participant !== where.me);
      const name = titleOf(conversation, where);
      const theirs = other ? face(where.people, other) : '<span class="avatar">·</span>';
      return row(conversation, where, `${theirs}<span class="name">${safe(name)}</span>`);
    })
    .join("");
}

export interface Where {
  readonly people: People;
  readonly me: UserId;
  /** Which one is open, so it can be marked as the one being read. */
  readonly openId: ConversationId | undefined;
  /** The conversations with a call going on in them right now. */
  readonly live: ReadonlySet<ConversationId>;
}

function row(conversation: Conversation, where: Where, inside: string): string {
  const open = conversation.id === where.openId ? ' aria-current="true"' : "";
  const live = where.live.has(conversation.id) ? '<span class="live">● LIVE</span>' : "";
  const unread = conversation.unreadCount ?? 0;
  const badge = unread > 0 ? `<span class="badge">${unread}</span>` : "";
  return `<li><button data-conversation="${safe(conversation.id)}"${open}>${inside}${live}${badge}</button></li>`;
}

/** The list itself: painted from the conversations as they stand, and the one thing that opens one. */
export class Sidebar {
  constructor(
    private readonly what: {
      readonly people: People;
      readonly me: UserId;
      readonly conversations: () => readonly Conversation[];
      readonly openId: () => ConversationId | undefined;
      readonly liveIn: () => ReadonlySet<ConversationId>;
      readonly open: (conversationId: ConversationId) => void;
    }
  ) {}

  wire(): void {
    element("lists").addEventListener("click", event => {
      const conversationId = pressedIn(event, "conversation");
      if (conversationId) this.what.open(conversationId);
    });
  }

  paint(): void {
    const all = this.what.conversations();
    const where: Where = {
      people: this.what.people,
      me: this.what.me,
      openId: this.what.openId(),
      live: this.what.liveIn()
    };
    paintChannels(element("channels"), all.filter(notBetweenTwo), where);
    paintDirects(element("directs"), onePerPerson(all.filter(isBetweenTwo), this.what.me), where);
    // A conversation with no name of its own is called by who is in it, so those names have to be known.
    for (const conversation of all) {
      if (conversation.title ?? conversation.alias) continue;
      this.what.people.learn(conversation.participantIds.slice(0, 4), conversation.id);
    }
  }
}

function notBetweenTwo(conversation: Conversation): boolean {
  return !isBetweenTwo(conversation);
}
