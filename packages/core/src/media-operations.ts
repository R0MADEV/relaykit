import { SdkError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import type { LinkPreview, MediaRef } from "./models.js";

export interface MediaOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
  /** How many bytes of downloaded attachments to keep in memory. Zero turns it off. */
  readonly cachedBytes: number;
  readonly now: () => number;
}

/** Lo que el homeserver dice de un enlace cambia poco, y una conversacion repinta el mismo enlace muchas veces. */
const previewFreshMs = 30 * 60 * 1000;

export class MediaOperations {
  private readonly previews = new Map<string, { readonly preview: LinkPreview; readonly askedAt: number }>();

  /** Insertion order is the order of this map, so the first entry is the one to drop. */
  private readonly cache = new Map<string, Uint8Array>();
  private cachedBytes = 0;

  constructor(private readonly context: MediaOperationsContext) {}

  async download(media: MediaRef): Promise<Uint8Array> {
    this.context.assertStarted();
    if (!media.source) {
      throw new SdkError("INVALID_INPUT", "The attachment has not been uploaded yet");
    }
    const kept = this.cache.get(media.source);
    // A copy, so whoever asked cannot change what everybody else will be given afterwards.
    if (kept) return Uint8Array.from(kept);
    try {
      const bytes = await this.context.adapter.downloadAttachment(media);
      this.keep(media.source, bytes);
      return bytes;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new SdkError("ADAPTER_ERROR", `The attachment could not be downloaded: ${reason}`);
    }
  }

  /**
   * Lo que hay detras de un enlace, para poder pintarlo sin que nadie tenga que abrirlo. Lo pide el
   * homeserver: si lo pidiera este dispositivo, quien publica el enlace sabria que alguien de esta
   * organizacion lo esta mirando, y cuando.
   */
  async preview(url: string): Promise<LinkPreview> {
    this.context.assertStarted();
    const wanted = url.trim();
    if (!isSomewhereToGo(wanted)) {
      throw new SdkError("INVALID_INPUT", "A link preview needs an http or https address");
    }
    const now = this.context.now();
    const known = this.previews.get(wanted);
    if (known && now - known.askedAt < previewFreshMs) return known.preview;
    const preview = await this.context.adapter.previewLink(wanted);
    this.previews.set(wanted, { preview, askedAt: now });
    return preview;
  }

  /** Downloaded files are somebody's content, so signing out drops them along with everything else. */
  forget(): void {
    this.cache.clear();
    this.cachedBytes = 0;
    this.previews.clear();
  }

  private keep(source: string, bytes: Uint8Array): void {
    // A file bigger than the whole cache would push out everything else for nothing, so it is not kept.
    if (bytes.byteLength > this.context.cachedBytes) return;
    this.cache.set(source, Uint8Array.from(bytes));
    this.cachedBytes += bytes.byteLength;
    for (const [oldest, dropped] of this.cache) {
      if (this.cachedBytes <= this.context.cachedBytes) break;
      if (oldest === source) break;
      this.cache.delete(oldest);
      this.cachedBytes -= dropped.byteLength;
    }
  }
}

/** Solo http y https: cualquier otra cosa no es un enlace que un homeserver pueda mirar. */
function isSomewhereToGo(url: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
