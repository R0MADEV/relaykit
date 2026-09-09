import { SdkError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import type { MediaRef } from "./models.js";

export interface MediaOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

export class MediaOperations {
  constructor(private readonly context: MediaOperationsContext) {}

  async download(media: MediaRef): Promise<Uint8Array> {
    this.context.assertStarted();
    if (!media.source) {
      throw new SdkError("INVALID_INPUT", "The attachment has not been uploaded yet");
    }
    try {
      return await this.context.adapter.downloadAttachment(media);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new SdkError("ADAPTER_ERROR", `The attachment could not be downloaded: ${reason}`);
    }
  }
}
