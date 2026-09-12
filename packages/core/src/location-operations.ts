import { SdkError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import type { ConversationId, GeoLocation, LiveLocation, ShareLocationInput } from "./models.js";

export interface LocationOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

/** Un dia entero ya es demasiado para algo que se suele compartir durante un trayecto. */
const longestShareMs = 24 * 60 * 60 * 1000;

export class LocationOperations {
  constructor(private readonly context: LocationOperationsContext) {}

  /**
   * El rato es obligatorio y acotado a proposito: lo que hace segura esta funcion es que acabe sola. Sin un
   * final, un descuido deja a alguien contando donde esta indefinidamente.
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
