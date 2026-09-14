import type { GeoLocation } from "@relaykit/core";

/**
 * `geo:43.26,-2.93` is how the protocol says a place, and what has to be undone to get back to numbers.
 *
 * Written once because a place is read in two: off a message in the timeline, and off a live share as it
 * moves. The sdk has no reader for this — it makes the uri with `ContentHelpers.makeLocationContent` and
 * leaves the undoing to whoever reads it — so it is here, once, rather than twice slightly differently.
 */
export function placeAt(uri: unknown): GeoLocation | undefined {
  if (typeof uri !== "string" || !uri.startsWith("geo:")) return undefined;
  // Everything after a `;` is uncertainty and the coordinate system, neither of which is the place itself.
  const [latitude, longitude] = uri.slice("geo:".length).split(";")[0]?.split(",").map(Number) ?? [];
  if (latitude === undefined || longitude === undefined) return undefined;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  return { latitude, longitude };
}
