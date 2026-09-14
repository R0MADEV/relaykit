import type { MessagingAdapter, PresenceAdapter } from "./adapter.js";
import { maxStatusMessageLength, presenceStates } from "./models.js";
import type { PresenceUpdate, UserId, UserPresence } from "./models.js";
import { SdkError } from "./errors.js";

export interface PresenceOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

export class PresenceOperations {
  constructor(private readonly context: PresenceOperationsContext) {}

  async set(update: PresenceUpdate): Promise<void> {
    this.context.assertStarted();
    if (!presenceStates.includes(update.presence)) {
      throw new SdkError("INVALID_INPUT", `Unknown presence: ${update.presence}`);
    }
    if ((update.statusMessage?.length ?? 0) > maxStatusMessageLength) {
      throw new SdkError(
        "INVALID_INPUT",
        `A status message can be at most ${maxStatusMessageLength} characters`
      );
    }
    await this.presence.setPresence(update);
  }

  /**
   * What somebody is doing now. Whoever opens a screen full of faces has to be able to ask: `presence.changed`
   * only says what changed while they were watching, and nothing changed before that is still true.
   */
  async of(userId: UserId): Promise<UserPresence | undefined> {
    this.context.assertStarted();
    return this.presence.getPresence(userId);
  }

  /** The one place that answers whether this adapter does this at all. */
  private get presence(): PresenceAdapter {
    const found = this.context.adapter.presence;
    if (!found)
      throw new SdkError("NOT_SUPPORTED", "Presence and typing are not something this homeserver has");
    return found;
  }
}
