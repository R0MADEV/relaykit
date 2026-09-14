import type { MediaRef, MessagingClient } from "@relaykit/web";

/** What an attachment is, which decides whether it is shown or only offered. */
export type Kind = "picture" | "film" | "recording" | "file";

/**
 * What kind of thing an attachment is, from the type it travelled with.
 *
 * The type and not the name: anybody can call a file `photo.png`, and what the browser is asked to render
 * is decided by this. Anything not plainly a picture, a film or a recording is a file — a name and a way to
 * save it — which is the safe thing to do with something nobody here understands.
 */
export function kindOf(mimeType: string | undefined): Kind {
  const type = (mimeType ?? "").toLowerCase().split("/")[0];
  if (type === "image") return "picture";
  if (type === "video") return "film";
  if (type === "audio") return "recording";
  return "file";
}

/**
 * Where a downloaded attachment can be drawn from.
 *
 * Fetched once each and kept for as long as the page runs: the timeline is repainted whole every time
 * anything moves, and downloading a photo on every repaint is downloading a photo several times a second.
 */
const fetched = new Map<string, string>();
const fetching = new Map<string, Promise<string | undefined>>();

export function addressOf(media: MediaRef): string | undefined {
  return fetched.get(media.source);
}

/** Fetches it if it has not been, and says whether anything new arrived so a screen knows to repaint. */
export async function fetchIfNeeded(client: MessagingClient, media: MediaRef): Promise<boolean> {
  if (fetched.has(media.source)) return false;
  const already = fetching.get(media.source);
  if (already) return false;
  const asking = download(client, media);
  fetching.set(media.source, asking);
  const address = await asking;
  fetching.delete(media.source);
  if (!address) return false;
  fetched.set(media.source, address);
  return true;
}

async function download(client: MessagingClient, media: MediaRef): Promise<string | undefined> {
  const bytes = await client.media.download(media).catch(() => undefined);
  if (!bytes) return undefined;
  // Copied into a buffer of its own: what came back may be a view on shared memory, which a Blob will not take.
  const own = new Uint8Array(bytes);
  return URL.createObjectURL(new Blob([own.buffer], { type: media.mimeType }));
}
