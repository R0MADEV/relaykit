import type { MessagingAdapter } from "./adapter.js";
import { maxStatusMessageLength, presenceStates } from "./models.js";
import type { PresenceUpdate } from "./models.js";
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
      throw new SdkError("INVALID_INPUT", `A status message can be at most ${maxStatusMessageLength} characters`);
    }
    await this.context.adapter.setPresence(update);
  }
}
