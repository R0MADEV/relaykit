import { SdkError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import type { ConversationId, GeoLocation, LiveLocation, ShareLocationInput } from "./models.js";

export interface LocationOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

/** A whole day is already too much for something usually shared for the length of a journey. */
const longestShareMs = 24 * 60 * 60 * 1000;

export class LocationOperations {
  constructor(private readonly context: LocationOperationsContext) {}

  /**
   * The while is required and bounded on purpose: what makes this safe is that it ends on its own. Without
   * an end, a slip leaves somebody telling where they are indefinitely.
   */
  async start(conversationId: ConversationId, input: ShareLocationInput): Promise<LiveLocation> {
    this.context.assertStarted();
    if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
      throw new SdkError("INVALID_INPUT", "Sharing where somebody is needs to say for how long");
    }
    if (input.durationMs > longestShareMs) {
      throw new SdkError("INVALID_INPUT", "Sharing where somebody is cannot last longer than a day");
    }
    return this.context.adapter.startLiveLocation(conversationId, input);
  }

  async update(sharingId: string, position: GeoLocation): Promise<void> {
    this.context.assertStarted();
    requirePlace(position);
    await this.context.adapter.updateLiveLocation(sharingId, position);
  }

  async stop(sharingId: string): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.stopLiveLocation(sharingId);
  }

  list(conversationId: ConversationId): Promise<readonly LiveLocation[]> {
    this.context.assertStarted();
    return this.context.adapter.listLiveLocations(conversationId);
  }
}

function requirePlace(position: GeoLocation): void {
  const isSomewhereOnEarth = Math.abs(position.latitude) <= 90 && Math.abs(position.longitude) <= 180;
  if (!isSomewhereOnEarth) {
    throw new SdkError("INVALID_INPUT", "That is not a place on Earth");
  }
}
