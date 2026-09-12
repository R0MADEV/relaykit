import { M_BEACON, M_BEACON_INFO, type MatrixClient } from "matrix-js-sdk";
import type { ConversationId, GeoLocation, LiveLocation, ShareLocationInput } from "@relaykit/core";
import { waitForRoom } from "./matrix-room-operations.js";

/**
 * In Matrix this is two things: a state event saying "I am going to keep telling you for this long", and then
 * the notices with each position, which hang off it. The state is keyed by whoever is sharing, so each person
 * can only have one live per conversation, and stopping it is writing it again with `live: false`.
 *
 * The SDK reads both and keeps a `Beacon` per room, with whether it is still live and the latest position. It
 * is asked rather than walking the history.
 */
export async function startMatrixLiveLocation(
  client: MatrixClient,
  conversationId: ConversationId,
  input: ShareLocationInput
): Promise<LiveLocation> {
  const startedAt = Date.now();
  const sharedBy = client.getSafeUserId();
  await client.sendStateEvent(conversationId, M_BEACON_INFO.name as never, {
    description: input.description,
    timeout: input.durationMs,
    live: true,
    "org.matrix.msc3488.ts": startedAt,
    "org.matrix.msc3488.asset": { type: "m.self" }
  } as never, sharedBy);
  // Writing the state and seeing it are not the same moment. Whoever starts sharing is about to say where
  // they are, and that needs the event just created, so this waits for it to arrive.
  await waitUntilTheBeaconArrives(client, conversationId, sharedBy);
  return {
    // The identifier is the state key itself: who is sharing, in this conversation.
    id: `${conversationId}|${sharedBy}`,
    conversationId,
    sharedBy,
    isLive: true,
    startedAt,
    durationMs: input.durationMs,
    ...(input.description ? { description: input.description } : {})
  };
}

export async function updateMatrixLiveLocation(
  client: MatrixClient,
  sharingId: string,
  position: GeoLocation
): Promise<void> {
  const { conversationId, sharedBy } = splitSharingId(sharingId);
  const beacon = await findBeacon(client, conversationId, sharedBy);
  if (!beacon?.isLive) {
    throw new Error("That sharing is no longer live");
  }
  await client.sendEvent(conversationId, M_BEACON.name as never, {
    "m.relates_to": { rel_type: "m.reference", event_id: beacon.beaconInfoId },
    "org.matrix.msc3488.location": {
      uri: `geo:${position.latitude},${position.longitude}`,
      ...(position.description ? { description: position.description } : {})
    },
    "org.matrix.msc3488.ts": Date.now()
  } as never);
}

/** Stopping writes the state again with `live: false`, keeping the rest so the history stays readable. */
export async function stopMatrixLiveLocation(client: MatrixClient, sharingId: string): Promise<void> {
  const { conversationId, sharedBy } = splitSharingId(sharingId);
  const beacon = await findBeacon(client, conversationId, sharedBy);
  await client.sendStateEvent(conversationId, M_BEACON_INFO.name as never, {
    ...(beacon?.content ?? {}),
    live: false
  } as never, sharedBy);
}

export async function listMatrixLiveLocations(
  client: MatrixClient,
  conversationId: ConversationId
): Promise<readonly LiveLocation[]> {
  const room = await waitForRoom(client, conversationId);
  return [...room.currentState.beacons.values()].map(beacon => {
    const content = beacon.beaconInfo;
    const position = beacon.latestLocationState?.uri;
    const place = position ? parseGeoUri(position) : undefined;
    return {
      id: `${conversationId}|${beacon.beaconInfoOwner}`,
      conversationId,
      sharedBy: beacon.beaconInfoOwner,
      isLive: beacon.isLive,
      startedAt: content?.timestamp ?? Date.now(),
      durationMs: content?.timeout ?? 0,
      ...(content?.description ? { description: content.description } : {}),
      ...(place ? { lastPosition: place } : {})
    };
  });
}

async function waitUntilTheBeaconArrives(
  client: MatrixClient,
  conversationId: string,
  sharedBy: string,
  timeoutMs = 10000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await findBeacon(client, conversationId, sharedBy)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function findBeacon(client: MatrixClient, conversationId: string, sharedBy: string) {
  const room = await waitForRoom(client, conversationId);
  const beacon = [...room.currentState.beacons.values()].find(item => item.beaconInfoOwner === sharedBy);
  return beacon
    ? { isLive: beacon.isLive, beaconInfoId: beacon.beaconInfoId, content: beacon.beaconInfo }
    : undefined;
}

function splitSharingId(sharingId: string): { conversationId: string; sharedBy: string } {
  const divide = sharingId.lastIndexOf("|");
  if (divide < 1) throw new Error(`That is not something being shared: ${sharingId}`);
  return { conversationId: sharingId.slice(0, divide), sharedBy: sharingId.slice(divide + 1) };
}

/** `geo:43.26,-2.93` is how the protocol says a place, and what has to be undone to get back to numbers. */
function parseGeoUri(uri: string): GeoLocation | undefined {
  const [latitude, longitude] = uri.replace(/^geo:/, "").split(";")[0]?.split(",").map(Number) ?? [];
  const isSomewhere = Number.isFinite(latitude) && Number.isFinite(longitude);
  return isSomewhere ? { latitude: latitude as number, longitude: longitude as number } : undefined;
}
