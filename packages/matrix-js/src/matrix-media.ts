import { RelayKitError } from "@relaykit/core";
import { ClientPrefix, EventType, Method, MsgType, type MatrixClient } from "matrix-js-sdk";
import "./matrix-proposals.js";
import type { EncryptedFile, FileInfo } from "matrix-js-sdk/lib/@types/media.js";
import type { StickerEventContent } from "matrix-js-sdk/lib/@types/events.js";
import type { UploadResponse } from "matrix-js-sdk";
import { encodeUri } from "matrix-js-sdk/lib/utils.js";
import type { RoomMessageEventContent } from "matrix-js-sdk/lib/@types/events.js";
import { decryptAttachment, encryptAttachment, type IEncryptedFile } from "matrix-encrypt-attachment";
import type {
  AvatarImage,
  ConversationId,
  FileInput,
  LinkPreview,
  MediaRef,
  Message,
  ThumbnailInput,
  MediaLimits
} from "@relaykit/core";
import { waitForRoom } from "./matrix-room-operations.js";
import { sendWithTransaction } from "./matrix-sending.js";

/**
 * A Uint8Array is usually a window onto a larger buffer, and handing that buffer to a Blob uploads
 * everything around the picture as well. What goes up is the window and nothing else. Answers with where
 * the homeserver put it, which is all either caller needs.
 */
export async function uploadAvatarImage(client: MatrixClient, image: AvatarImage): Promise<string> {
  const upload = await client.uploadContent(new Blob([toArrayBuffer(image.data)]), {
    type: image.mimeType,
    includeFilename: false
  });
  return upload.content_uri;
}

/** What `Attachment.source` carries for the Matrix adapter. */
export interface MatrixAttachmentSource {
  readonly url: string;
  readonly file?: IEncryptedFile;
}

/**
 * Files on their way up, and stopping them.
 *
 * Kept in an instance rather than beside the module, because two accounts open at once are two sets of
 * uploads and stopping one must not stop the other's.
 */
export class MatrixMedia {
  private readonly onTheirWay = new Map<string, Promise<UploadResponse>>();

  /** The same send, with the upload remembered for as long as it is going. */
  async send(
    client: MatrixClient,
    conversationId: ConversationId,
    file: FileInput,
    transactionId: string | undefined,
    onProgress: ((fraction: number) => void) | undefined
  ): Promise<Message> {
    return sendMatrixAttachment(client, conversationId, file, transactionId, onProgress, this.onTheirWay);
  }

  /**
   * Stopping a file on its way up. The SDK does the stopping, and it wants the promise its own upload gave
   * back, so that is what was kept. Says whether there was anything to stop rather than pretending there was.
   */
  async stopSending(transactionId: string): Promise<boolean> {
    const going = this.onTheirWay.get(transactionId);
    if (!going) return false;
    this.onTheirWay.delete(transactionId);
    return this.client?.cancelUpload(going) ?? false;
  }

  /** The client that is doing the uploading, remembered when one starts. */
  private client: MatrixClient | undefined;

  /** Told which client is uploading, so stopping does not need to be handed one. */
  remember(client: MatrixClient): void {
    this.client = client;
  }
}

export async function sendMatrixAttachment(
  client: MatrixClient,
  conversationId: ConversationId,
  file: FileInput,
  transactionId: string | undefined,
  onProgress: ((fraction: number) => void) | undefined,
  /** Where to leave the upload while it is going, so it can be stopped. */
  onTheirWay?: Map<string, Promise<UploadResponse>>
): Promise<Message> {
  // Uploading before knowing whether the room is encrypted could publish the file in the clear.
  const room = await waitForRoom(client, conversationId);
  const isEncrypted = room.hasEncryptionStateEvent();
  const encrypted = isEncrypted ? await encryptAttachment(toArrayBuffer(file.data)) : undefined;
  const bytes = encrypted ? encrypted.data : toArrayBuffer(file.data);
  // The SDK only reports intermediate progress in browsers (XHR); always bracket the upload with 0 and 1.
  onProgress?.(0);
  // Kept while it is going, and let go afterwards: the SDK stops an upload by the promise it gave back.
  const going = client.uploadContent(new Blob([bytes]), {
    type: isEncrypted ? "application/octet-stream" : file.mimeType,
    includeFilename: !isEncrypted,
    name: file.name,
    progressHandler: progress =>
      onProgress?.(progress.total > 0 ? Math.min(progress.loaded / progress.total, 0.99) : 0)
  });
  if (transactionId) onTheirWay?.set(transactionId, going);
  const upload = await going.finally(() => {
    if (transactionId) onTheirWay?.delete(transactionId);
  });
  const thumbnail = file.thumbnail ? await uploadThumbnail(client, file.thumbnail, isEncrypted) : undefined;
  onProgress?.(1);
  const said: SentFile = {
    body: file.name,
    info: {
      mimetype: file.mimeType,
      size: file.data.byteLength,
      ...(file.width !== undefined ? { w: file.width } : {}),
      ...(file.height !== undefined ? { h: file.height } : {}),
      ...(file.voice ? { duration: file.voice.durationMs } : {}),
      // Where every client that paints it puts it, which is what makes it useful.
      ...(file.blurhash ? { "xyz.amorgan.blurhash": file.blurhash } : {}),
      ...(thumbnail ? thumbnail.info : {})
    }
  };
  // A voice note says so in three places, which is what other clients look at to draw it instead of listing it.
  if (file.voice) {
    said["org.matrix.msc3245.voice"] = {};
    said["org.matrix.msc1767.audio"] = {
      duration: file.voice.durationMs,
      ...(file.voice.waveform ? { waveform: [...file.voice.waveform] } : {})
    };
  }
  // Written out rather than spread: what encrypts describes the same thing as the SDK does, but says the
  // hashes and the version may be missing where the SDK says they are always there. They always are — so
  // this is where the two descriptions are reconciled, in the open, instead of by assertion.
  if (encrypted) {
    said.file = {
      url: upload.content_uri,
      key: encrypted.info.key,
      iv: encrypted.info.iv,
      hashes: encrypted.info.hashes ?? {},
      v: encrypted.info.v ?? "v2"
    };
  } else {
    said.url = upload.content_uri;
  }

  // Each kind goes out by name: a member of a union told apart by `msgtype` cannot be built from a value
  // worked out while the program runs, so naming it is what lets the compiler check what is sent.
  const sent = (content: RoomMessageEventContent) =>
    sendWithTransaction(
      client,
      conversationId,
      content,
      transactionId,
      // A sticker is not a message: it goes under its own event type, which is how whoever receives it
      // knows to draw it on its own rather than list it as a file. The SDK's sticker content has a `url`
      // and no `file`, so it cannot describe an encrypted one — and a sticker sent into an encrypted
      // conversation is exactly that. This is the one thing here the compiler is told rather than shown.
      file.sticker === true
        ? () =>
            client.sendEvent(
              conversationId,
              EventType.Sticker,
              content as unknown as StickerEventContent,
              transactionId
            )
        : () => client.sendMessage(conversationId, content, transactionId)
    );
  const kind = msgTypeFor(file.mimeType);
  if (kind === MsgType.Image) return sent({ ...said, msgtype: MsgType.Image });
  if (kind === MsgType.Video) return sent({ ...said, msgtype: MsgType.Video });
  if (kind === MsgType.Audio) return sent({ ...said, msgtype: MsgType.Audio });
  return sent({ ...said, msgtype: MsgType.File });
}

/** A thumbnail is uploaded the same way as the file, and encrypted whenever the file is. */
async function uploadThumbnail(
  client: MatrixClient,
  thumbnail: ThumbnailInput,
  isEncrypted: boolean
): Promise<{ readonly info: Record<string, unknown> }> {
  const encrypted = isEncrypted ? await encryptAttachment(toArrayBuffer(thumbnail.data)) : undefined;
  const bytes = encrypted ? encrypted.data : toArrayBuffer(thumbnail.data);
  const upload = await client.uploadContent(new Blob([bytes]), {
    type: isEncrypted ? "application/octet-stream" : thumbnail.mimeType,
    includeFilename: false
  });
  return {
    info: {
      thumbnail_info: {
        mimetype: thumbnail.mimeType,
        size: thumbnail.data.byteLength,
        ...(thumbnail.width !== undefined ? { w: thumbnail.width } : {}),
        ...(thumbnail.height !== undefined ? { h: thumbnail.height } : {})
      },
      ...(encrypted
        ? { thumbnail_file: { ...encrypted.info, url: upload.content_uri } }
        : { thumbnail_url: upload.content_uri })
    }
  };
}

/**
 * What the homeserver knows about a link. It looks, not this device: that way whoever publishes the link does
 * not learn that somebody from this organisation is opening it, or when. The image comes back like any other,
 * to be fetched with `media.download`.
 */
export async function previewMatrixLink(client: MatrixClient, url: string): Promise<LinkPreview> {
  const preview = await client.getUrlPreview(url, Date.now());
  const image = typeof preview["og:image"] === "string" ? preview["og:image"] : undefined;
  const title = typeof preview["og:title"] === "string" ? preview["og:title"] : undefined;
  const description = typeof preview["og:description"] === "string" ? preview["og:description"] : undefined;
  const mimeType = typeof preview["og:image:type"] === "string" ? preview["og:image:type"] : "image/*";
  return {
    url,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(image ? { image: { mimeType, source: JSON.stringify({ url: image }) } } : {})
  };
}

export async function downloadMatrixAttachment(
  client: MatrixClient,
  attachment: MediaRef
): Promise<Uint8Array<ArrayBuffer>> {
  const source = parseSource(attachment.source);
  const { data } = await downloadFromMediaServer(client, source.url);
  const bytes = toArrayBuffer(data);
  return new Uint8Array(source.file ? await decryptAttachment(bytes, source.file) : bytes);
}

/**
 * Everything this library pulls off the media server comes through here, over the SDK's own authenticated
 * request: it carries the access token, so nobody writes an Authorization header by hand, and it knows where
 * the media endpoints live. A size asks for a thumbnail instead of the original.
 *
 * Cropping, not scaling: a picture shown in a circle is cropped by whoever draws it anyway, and the server
 * doing it sends fewer bytes than a scaled rectangle that then gets cut.
 */
export async function downloadFromMediaServer(
  client: MatrixClient,
  mxcUrl: string,
  size?: number
): Promise<{ readonly data: Uint8Array<ArrayBuffer>; readonly mimeType: string }> {
  const { server, mediaId } = splitMxcUrl(mxcUrl);
  const wholeThing = size === undefined;
  const blob = await client.http.authedRequest<Blob>(
    Method.Get,
    encodeUri(wholeThing ? "/media/download/$server/$mediaId" : "/media/thumbnail/$server/$mediaId", {
      $server: server,
      $mediaId: mediaId
    }),
    wholeThing ? undefined : { width: String(size), height: String(size), method: "crop" },
    undefined,
    { prefix: ClientPrefix.V1, rawResponseBody: true }
  );
  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    mimeType: blob.type || "application/octet-stream"
  };
}

function splitMxcUrl(mxcUrl: string): { readonly server: string; readonly mediaId: string } {
  const withoutScheme = mxcUrl.startsWith("mxc://") ? mxcUrl.slice("mxc://".length) : "";
  const divide = withoutScheme.indexOf("/");
  if (divide < 1 || divide === withoutScheme.length - 1) {
    throw new RelayKitError("INVALID_INPUT", "That does not point at anything on a media server");
  }
  return { server: withoutScheme.slice(0, divide), mediaId: withoutScheme.slice(divide + 1) };
}

function parseSource(source: string): MatrixAttachmentSource {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new RelayKitError("INVALID_INPUT", "The attachment source is not valid");
  }
  if (!isAttachmentSource(parsed))
    throw new RelayKitError("INVALID_INPUT", "The attachment source is not valid");
  return parsed;
}

/** What was parsed, once it has been looked at: anything without a url is not one of ours. */
function isAttachmentSource(value: unknown): value is MatrixAttachmentSource {
  if (typeof value !== "object" || value === null) return false;
  return "url" in value && typeof value.url === "string";
}

/**
 * Everything a sent file carries besides which kind of file it is.
 *
 * `m.relates_to` is named though a file never carries one: the SDK's content is told apart by which kind of
 * relation it has, so a shape that never mentions relations matches none of them.
 */
interface SentFile {
  body: string;
  info: FileInfo;
  url?: string;
  file?: EncryptedFile;
  "org.matrix.msc3245.voice"?: Record<string, never>;
  "org.matrix.msc1767.audio"?: { duration: number; waveform?: number[] };
  "m.relates_to"?: Record<string, unknown>;
}

function msgTypeFor(mimeType: string): MsgType {
  if (mimeType.startsWith("image/")) return MsgType.Image;
  if (mimeType.startsWith("video/")) return MsgType.Video;
  if (mimeType.startsWith("audio/")) return MsgType.Audio;
  return MsgType.File;
}

/**
 * The window a Uint8Array points at, as a buffer of its own.
 *
 * Copied into a new one rather than sliced off the buffer behind it: a typed array may sit on something
 * shared, so slicing gives back something that might be shared too, and saying otherwise was an assertion.
 * The copy is the same work — slicing copies as well — and it is an ArrayBuffer because it was made as one.
 */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const window = new ArrayBuffer(data.byteLength);
  new Uint8Array(window).set(data);
  return window;
}

/**
 * What this homeserver will take. Its own answer, asked with its own method: every homeserver has a limit and
 * publishes it, and a file refused after being sent is ten minutes of somebody's connection for nothing.
 *
 * A homeserver that will not say is taken at its word rather than guessed at: when there is no number, there
 * is no limit to enforce here, and the send finds out the usual way.
 */
export async function askWhatTheHomeserverTakes(client: MatrixClient): Promise<MediaLimits> {
  const said = await client.getMediaConfig().catch(() => ({}));
  const allowed = (said as { "m.upload.size"?: unknown })["m.upload.size"];
  return { maxUploadBytes: typeof allowed === "number" ? allowed : Number.MAX_SAFE_INTEGER };
}
