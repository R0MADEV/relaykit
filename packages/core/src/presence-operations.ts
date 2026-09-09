import type { MessagingAdapter } from "./adapter.js";
import type { PresenceUpdate } from "./models.js";

export interface PresenceOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

export class PresenceOperations {
  constructor(private readonly context: PresenceOperationsContext) {}

  async set(update: PresenceUpdate): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.setPresence(update);
  }
}
