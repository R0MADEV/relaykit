import type { ConversationId, MessagingClient, User, UserId, UserPresence } from "@relaykit/web";

/**
 * What is known about the people on screen: how they are called and whether they are about.
 *
 * Kept here because the same person is drawn in several places at once — a row in the list, a face beside a
 * message, a box in a call — and each of those asking the homeserver on its own is what makes a screen full
 * of names slow. Nothing is asked for twice, and what is not known yet draws as the identifier until it is.
 */
export class People {
  private readonly known = new Map<UserId, User>();
  private readonly there = new Map<UserId, UserPresence>();
  private readonly asking = new Set<UserId>();

  constructor(
    private readonly client: MessagingClient,
    /** Called once whatever was missing has arrived, so whoever drew the identifier can draw the name. */
    private readonly arrived: () => void
  ) {}

  nameOf(userId: UserId): string {
    return this.known.get(userId)?.displayName ?? bareName(userId);
  }

  /** Two letters for a face with no picture: the ones a person would use writing initials by hand. */
  initialsOf(userId: UserId): string {
    const words = this.nameOf(userId).trim().split(/\s+/);
    const first = words[0]?.[0] ?? "?";
    const second = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
    return (first + second).toUpperCase();
  }

  /** The dot on a face. Nothing at all while it is unknown, which is not the same as being away. */
  dotFor(userId: UserId): "here" | "away" | "gone" | undefined {
    const presence = this.there.get(userId)?.presence;
    if (presence === "online") return "here";
    if (presence === "unavailable") return "away";
    if (presence === "offline") return "gone";
    return undefined;
  }

  /** What arrived on its own while somebody was watching. */
  heard(presence: UserPresence): void {
    this.there.set(presence.userId, presence);
    this.arrived();
  }

  /**
   * Asks about whoever is not known yet. Each identifier is asked about once, however many screens want it:
   * a conversation of forty people redrawn on every message would otherwise be forty requests a message.
   */
  learn(userIds: Iterable<UserId>, inside?: ConversationId): void {
    const missing = [...userIds].filter(userId => !this.known.has(userId) && !this.asking.has(userId));
    if (missing.length === 0) return;
    for (const userId of missing) this.asking.add(userId);
    void Promise.all(missing.map(userId => this.ask(userId, inside))).then(() => this.arrived());
  }

  private async ask(userId: UserId, inside: ConversationId | undefined): Promise<void> {
    // Somebody who cannot be described is still somebody to talk to: the identifier stands in, and asking
    // again on the next repaint would be a request a second for a homeserver that has already said no.
    // Named with the conversation, so somebody already in it is described by what the sync holds rather
    // than by a request of their own: a sidebar of forty names was forty requests before this.
    const profile = await this.client.users.profile(userId, inside).catch(() => undefined);
    this.known.set(userId, profile ?? { id: userId });
    const presence = await this.client.presence.of(userId).catch(() => undefined);
    if (presence) this.there.set(userId, presence);
  }
}

/** `@ana:example.org` is Ana to anybody reading, until the homeserver says what she calls herself. */
function bareName(userId: UserId): string {
  return userId.replace(/^@/, "").split(":")[0] ?? userId;
}
