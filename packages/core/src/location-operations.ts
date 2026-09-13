import { SdkError } from "./errors.js";
import { longestLocationShareMs } from "./models.js";
import type { MessagingAdapter, LocationAdapter } from "./adapter.js";
import type { ConversationId, GeoLocation, LiveLocation, ShareLocationInput } from "./models.js";

export interface LocationOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

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
    if (input.durationMs > longestLocationShareMs) {
      throw new SdkError("INVALID_INPUT", "Sharing where somebody is cannot last longer than a day");
    }
    return this.location.startLiveLocation(conversationId, input);
  }

  async update(sharingId: string, position: GeoLocation): Promise<void> {
    this.context.assertStarted();
    requirePlace(position);
    await this.location.updateLiveLocation(sharingId, position);
  }

  async stop(sharingId: string): Promise<void> {
    this.context.assertStarted();
    await this.location.stopLiveLocation(sharingId);
  }

  async list(conversationId: ConversationId): Promise<readonly LiveLocation[]> {
    this.context.assertStarted();
    return this.location.listLiveLocations(conversationId);
  }

  /** The one place that answers whether this adapter does this at all. */
  private get location(): LocationAdapter {
    const location = this.context.adapter.location;
    if (!location) throw new SdkError("NOT_SUPPORTED", "Telling where somebody is live is not something this homeserver does");
    return location;
  }
}

function requirePlace(position: GeoLocation): void {
  const isSomewhereOnEarth = Math.abs(position.latitude) <= 90 && Math.abs(position.longitude) <= 180;
  if (!isSomewhereOnEarth) {
    throw new SdkError("INVALID_INPUT", "That is not a place on Earth");
  }
}
