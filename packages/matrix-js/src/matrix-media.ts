import {
  ClientPrefix,
  EventType,
  Method,
  MsgType,
  type MatrixClient
} from "matrix-js-sdk";
import { encodeUri } from "matrix-js-sdk/lib/utils.js";
import type { RoomMessageEventContent } from "matrix-js-sdk/lib/@types/events.js";
import { decryptAttachment, encryptAttachment, type IEncryptedFile } from "matrix-encrypt-attachment";
import type { ConversationId, FileInput, LinkPreview, MediaRef, Message, ThumbnailInput } from "@relaykit/core";
import { sendWithTransaction, waitForRoom } from "./matrix-room-operations.js";

/** What `Attachment.source` carries for the Matrix adapter. */
export interface MatrixAttachmentSource {
  readonly url: string;
  readonly file?: IEncryptedFile;
}

export async function sendMatrixAttachment(
  client: MatrixClient,
  conversationId: ConversationId,
  file: FileInput,
  transactionId: string | undefined,
  onProgress: ((fraction: number) => void) | undefined
): Promise<Message> {
  // Uploading before knowing whether the room is encrypted could publish the file in the clear.
  const room = await waitForRoom(client, conversationId);
  const isEncrypted = room.hasEncryptionStateEvent();
  const encrypted = isEncrypted ? await encryptAttachment(toArrayBuffer(file.data)) : undefined;
  const bytes = encrypted ? encrypted.data : toArrayBuffer(file.data);
  // The SDK only reports intermediate progress in browsers (XHR); always bracket the upload with 0 and 1.
  onProgress?.(0);
  const upload = await client.uploadContent(new Blob([bytes]), {
    type: isEncrypted ? "application/octet-stream" : file.mimeType,
    includeFilename: !isEncrypted,
    name: file.name,
    progressHandler: progress => onProgress?.(progress.total > 0 ? Math.min(progress.loaded / progress.total, 0.99) : 0)
  });
  const thumbnail = file.thumbnail ? await uploadThumbnail(client, file.thumbnail, isEncrypted) : undefined;
  onProgress?.(1);
  const content = {
    msgtype: msgTypeFor(file.mimeType),
    body: file.name,
    info: {
      mimetype: file.mimeType,
      size: file.data.byteLength,
      ...(file.width !== undefined ? { w: file.width } : {}),
      ...(file.height !== undefined ? { h: file.height } : {}),
      ...(file.voice ? { duration: file.voice.durationMs } : {}),
      // Donde lo ponen todos los clientes que lo pintan, que es lo que lo hace util.
      ...(file.blurhash ? { "xyz.amorgan.blurhash": file.blurhash } : {}),
      ...(thumbnail ? thumbnail.info : {})
    },
    // A voice note says so in three places, which is what other clients look at to draw it instead of listing it.
    ...(file.voice ? {
      "org.matrix.msc3245.voice": {},
      "org.matrix.msc1767.audio": {
        duration: file.voice.durationMs,
        ...(file.voice.waveform ? { waveform: [...file.voice.waveform] } : {})
      }
    } : {}),
    ...(encrypted ? { file: { ...encrypted.info, url: upload.content_uri } } : { url: upload.content_uri })
  };
  // The SDK's message content union cannot be built from a conditional spread; the shape follows the spec.
  // Una pegatina no es un mensaje: es su propio tipo de evento, y por eso quien la recibe puede pintarla sola.
  return sendWithTransaction(
    client,
    conversationId,
    content as unknown as RoomMessageEventContent,
    transactionId,
    file.sticker ? EventType.Sticker : undefined
  );
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
 * Lo que el homeserver sabe de un enlace. Lo mira el, no este dispositivo: asi quien publica el enlace no se
 * entera de que alguien de esta organizacion lo esta abriendo, ni cuando. La imagen vuelve como cualquier otra,
 * para descargarla con `media.download`.
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

export async function downloadMatrixAttachment(client: MatrixClient, attachment: MediaRef): Promise<Uint8Array> {
  const source = parseSource(attachment.source);
  const { data } = await downloadFromMediaServer(client, source.url);
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
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
): Promise<{ readonly data: Uint8Array; readonly mimeType: string }> {
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
    throw new Error(`This does not point at anything on a media server: ${mxcUrl}`);
  }
  return { server: withoutScheme.slice(0, divide), mediaId: withoutScheme.slice(divide + 1) };
}

function parseSource(source: string): MatrixAttachmentSource {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("The attachment source is not valid");
  }
  const isSource = typeof parsed === "object" && parsed !== null && typeof (parsed as { url?: unknown }).url === "string";
  if (!isSource) throw new Error("The attachment source is not valid");
  return parsed as MatrixAttachmentSource;
}

function msgTypeFor(mimeType: string): string {
  if (mimeType.startsWith("image/")) return MsgType.Image;
  if (mimeType.startsWith("video/")) return MsgType.Video;
  if (mimeType.startsWith("audio/")) return MsgType.Audio;
  return MsgType.File;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
