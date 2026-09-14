/**
 * The list of everything there is to talk in: the channels, and the people.
 *
 * What goes where is decided here rather than by whoever hands the list over, because it is one rule read two
 * ways — a conversation between two people with no name of its own is a person, however it was made.
 */
import type { Conversation, ConversationId, UserId } from "@relaykit/web";
import type { People } from "./people.js";
import { element, pressedIn, safe } from "./dom.js";

/**
 * What a conversation is called.
 *
 * Its own name if it has one, then the name people type instead of the identifier, and failing both, whoever
 * is in it — which is what a conversation with no name is to anybody reading. The identifier is never shown:
 * `!xdaZyxIsWTWbfHZvoN:localhost` tells nobody anything.
 */
export function titleOf(conversation: Conversation, people: People, me: UserId): string {
  if (conversation.title) return conversation.title;
  if (conversation.alias) return conversation.alias;
  const others = conversation.participantIds.filter(participant => participant !== me);
  if (others.length === 0) return "Conversación vacía";
  const named = others.slice(0, 3).map(participant => people.nameOf(participant));
  const rest = others.length - named.length;
  return rest > 0 ? `${named.join(", ")} +${rest}` : named.join(", ");
}

/**
 * Whether a conversation is one person talking to another.
 *
 * The flag when there is one, and otherwise what it plainly is: two people and no name is a direct chat,
 * however it was made. A room made by a script without the flag is still two people to whoever reads it, and
 * putting it under channels called by the other person's name is a channel nobody can tell from a person.
 */
export function isBetweenTwo(conversation: Conversation): boolean {
  if (conversation.isDirect) return true;
  const hasAName = Boolean(conversation.title ?? conversation.alias);
  return !hasAName && conversation.participantIds.length === 2;
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
      const name = titleOf(conversation, where.people, where.me);
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
      const name = titleOf(conversation, where.people, where.me);
      return row(
        conversation,
        where,
        `<span class="avatar"${dot(other, where.people)}>${safe(faceOf(other, where.people))}</span>
        <span class="name">${safe(name)}</span>`
      );
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

function faceOf(userId: UserId | undefined, people: People): string {
  return userId ? people.initialsOf(userId) : "·";
}

function dot(userId: UserId | undefined, people: People): string {
  const there = userId ? people.dotFor(userId) : undefined;
  return there ? ` data-there="${there}"` : "";
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
