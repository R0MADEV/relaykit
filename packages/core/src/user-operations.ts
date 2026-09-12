import { SdkError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import type { MessagingStorage } from "./storage.js";
import type { AvatarImage, AvatarOptions, ConversationId, SearchUsersOptions, User, UserId } from "./models.js";

export interface UserOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly storage?: MessagingStorage;
  readonly assertStarted: () => void;
  readonly now: () => number;
  /** How many bytes of pictures to keep. Zero keeps none. */
  readonly cachedAvatarBytes: number;
}

/** Long enough that a screen full of names costs one round trip, short enough that a rename shows up. */
const profileFreshMs = 5 * 60 * 1000;

/** Enough people to fill a screen. More than this is a list nobody reads to the end. */
const peoplePerSearch = 20;

export class UserOperations {
  private readonly profiles = new Map<string, { readonly user: User; readonly askedAt: number }>();
  private readonly avatars = new Map<string, { readonly image: AvatarImage | undefined; readonly askedAt: number }>();
  private heldBytes = 0;

  constructor(private readonly context: UserOperationsContext) {}

  /**
   * Somebody can go by a different name in one conversation than everywhere else, so naming the conversation
   * gives the name they use there. Without it, the name they use everywhere.
   */
  async profile(userId: UserId, conversationId?: ConversationId): Promise<User> {
    const wanted = this.require(userId);
    // A conversation list paints the same handful of names over and over, and each one was a request.
    const key = heldKey(wanted, conversationId, undefined);
    const now = this.context.now();
    const known = this.profiles.get(key);
    if (known && now - known.askedAt < profileFreshMs) return known.user;
    try {
      const user = await this.context.adapter.getProfile(wanted, conversationId);
      this.profiles.set(key, { user, askedAt: now });
      // Kept for the next time there is no homeserver to ask, so a screen shows names and not identifiers.
      if (user.displayName) await this.context.storage?.saveProfiles([user]);
      return user;
    } catch (error) {
      const kept = (await this.context.storage?.getProfiles() ?? []).find(profile => profile.id === wanted);
      if (!kept) throw error;
      return kept;
    }
  }

  /** Insertion order decides what goes first, so the oldest picture is the one dropped. */
  private keep(key: string, image: AvatarImage | undefined, now: number): void {
    // Turned off means nothing is held, not even the answer that somebody has no picture: that would still be
    // an entry per person, growing for as long as the application is open.
    if (this.context.cachedAvatarBytes === 0) return;
    const weight = image?.data.byteLength ?? 0;
    // A picture bigger than everything held would push out the rest for nothing, so it is shown and forgotten.
    if (weight > this.context.cachedAvatarBytes) return;
    this.avatars.set(key, { image, askedAt: now });
    this.heldBytes += weight;
    for (const [oldest, held] of this.avatars) {
      if (this.heldBytes <= this.context.cachedAvatarBytes) break;
      if (oldest === key) break;
      this.avatars.delete(oldest);
      this.heldBytes -= held.image?.data.byteLength ?? 0;
    }
  }

  /**
   * Something changed in this conversation, and a member renaming themselves or changing their picture is one
   * of the things that can be. What was held about that conversation is dropped so the change shows at once.
   */
  forgetConversation(conversationId: ConversationId): void {
    for (const held of [this.profiles, this.avatars]) {
      for (const key of [...held.keys()]) {
        if (!isAboutConversation(key, conversationId)) continue;
        if (held === this.avatars) this.heldBytes -= this.avatars.get(key)?.image?.data.byteLength ?? 0;
        held.delete(key);
      }
    }
  }

  /** Who everybody is only holds while the client runs, and a rename has to be seen at once. */
  forget(userId?: UserId): void {
    if (!userId) {
      this.profiles.clear();
      this.avatars.clear();
      this.heldBytes = 0;
      return;
    }
    for (const held of [this.profiles, this.avatars]) {
      for (const key of [...held.keys()]) {
        if (!isAboutUser(key, userId)) continue;
        if (held === this.avatars) this.heldBytes -= this.avatars.get(key)?.image?.data.byteLength ?? 0;
        held.delete(key);
      }
    }
  }

  /**
   * A picture is bytes, and a list repaints often. Fetching the same one on every repaint was the cost left
   * once names stopped being asked for.
   */
  async avatar(userId: UserId, options: AvatarOptions = {}): Promise<AvatarImage | undefined> {
    const wanted = this.require(userId);
    const { conversationId, size } = options;
    // The size is part of what is being held: the same person at two sizes is two pictures, and handing out
    // the wrong one paints a thumbnail where the original belongs, or the other way round.
    const key = heldKey(wanted, conversationId, size);
    const now = this.context.now();
    const known = this.avatars.get(key);
    if (known && now - known.askedAt < profileFreshMs) return copyOf(known.image);
    const image = await this.context.adapter.getAvatar(wanted, conversationId, size);
    this.keep(key, image, now);
    return copyOf(image);
  }

  /** Finds people by the name they go by, which is the only way to invite somebody whose id nobody knows. */
  async search(query: string, options: SearchUsersOptions = {}): Promise<readonly User[]> {
    this.context.assertStarted();
    const wanted = query.trim();
    if (!wanted) {
      throw new SdkError("INVALID_INPUT", "A search needs something to look for");
    }
    const limit = options.limit ?? peoplePerSearch;
    if (limit < 1) {
      throw new SdkError("INVALID_INPUT", "A search cannot ask for fewer than one person");
    }
    return this.context.adapter.searchUsers(wanted, limit);
  }

  /** People whose messages this account does not want to see. */
  async ignored(): Promise<readonly UserId[]> {
    this.context.assertStarted();
    return this.context.adapter.listIgnoredUsers();
  }

  async ignore(userId: UserId): Promise<void> {
    const wanted = this.require(userId);
    const current = await this.context.adapter.listIgnoredUsers();
    if (current.includes(wanted)) return;
    await this.context.adapter.setIgnoredUsers([...current, wanted]);
  }

  async unignore(userId: UserId): Promise<void> {
    const wanted = this.require(userId);
    const current = await this.context.adapter.listIgnoredUsers();
    await this.context.adapter.setIgnoredUsers(current.filter(ignored => ignored !== wanted));
  }

  async setDisplayName(displayName: string): Promise<void> {
    this.context.assertStarted();
    if (!displayName.trim()) {
      throw new SdkError("INVALID_INPUT", "A display name cannot be empty");
    }
    await this.context.adapter.setDisplayName(displayName.trim());
    this.forget();
  }

  async setAvatar(image: AvatarImage): Promise<void> {
    this.context.assertStarted();
    if (image.data.byteLength === 0 || !image.mimeType.trim()) {
      throw new SdkError("INVALID_INPUT", "An avatar needs content and a type");
    }
    await this.context.adapter.setAvatar(image);
    this.forget();
  }

  private require(userId: UserId): UserId {
    this.context.assertStarted();
    const trimmed = userId.trim();
    if (!trimmed) {
      throw new SdkError("INVALID_INPUT", "A user id is required");
    }
    return trimmed;
  }
}

/**
 * One shape for everything held about a person, so what forgets it matches what kept it. The separator is a
 * character that cannot appear in a Matrix identifier, which leaves the three parts readable apart.
 */
function heldKey(userId: UserId, conversationId: ConversationId | undefined, size: number | undefined): string {
  return `${conversationId ?? ""}|${userId}|${size ?? ""}`;
}

function isAboutConversation(key: string, conversationId: ConversationId): boolean {
  return key.startsWith(`${conversationId}|`);
}

function isAboutUser(key: string, userId: UserId): boolean {
  return key.split("|")[1] === userId;
}

/** Handing out a copy, so whoever asked cannot change what everybody else will be given afterwards. */
function copyOf(image: AvatarImage | undefined): AvatarImage | undefined {
  return image ? { ...image, data: Uint8Array.from(image.data) } : undefined;
}
