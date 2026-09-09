import { type MatrixClient } from "matrix-js-sdk";
import type { RoomMessageEventContent } from "matrix-js-sdk/lib/@types/events.js";
import { decryptAttachment, encryptAttachment, type IEncryptedFile } from "matrix-encrypt-attachment";
import type { ConversationId, FileInput, MediaRef, Message, ThumbnailInput } from "@relaykit/core";
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
      ...(thumbnail ? thumbnail.info : {})
    },
    ...(encrypted ? { file: { ...encrypted.info, url: upload.content_uri } } : { url: upload.content_uri })
  };
  // The SDK's message content union cannot be built from a conditional spread; the shape follows the spec.
  return sendWithTransaction(client, conversationId, content as unknown as RoomMessageEventContent, transactionId);
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

export async function downloadMatrixAttachment(client: MatrixClient, attachment: MediaRef): Promise<Uint8Array> {
  const source = parseSource(attachment.source);
  const url = client.mxcUrlToHttp(source.url, undefined, undefined, undefined, false, true, true);
  const accessToken = client.getAccessToken();
  if (!url || !accessToken) throw new Error("The attachment cannot be resolved");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`The media server responded with status ${response.status}`);
  const data = await response.arrayBuffer();
  return new Uint8Array(source.file ? await decryptAttachment(data, source.file) : data);
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
  if (mimeType.startsWith("image/")) return "m.image";
  if (mimeType.startsWith("video/")) return "m.video";
  if (mimeType.startsWith("audio/")) return "m.audio";
  return "m.file";
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
