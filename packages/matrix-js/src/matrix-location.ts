import { M_BEACON, M_BEACON_INFO, type MatrixClient } from "matrix-js-sdk";
import type { ConversationId, GeoLocation, LiveLocation, ShareLocationInput } from "@relaykit/core";
import { waitForRoom } from "./matrix-room-operations.js";

/**
 * En Matrix esto son dos cosas: un evento de estado que dice "voy a ir contando durante este rato", y luego
 * los avisos con cada posicion, que cuelgan de el. El estado lleva el nombre de quien comparte como clave, asi
 * que cada persona solo puede tener uno vivo por conversacion, y pararlo es reescribirlo con `live: false`.
 *
 * El SDK sabe leer ambos y mantiene un modelo `Beacon` por sala, con si sigue vivo y la ultima posicion. Se le
 * pregunta a el en vez de recorrer el historial.
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
  // Escribir el estado y verlo no son el mismo momento. Quien empieza a compartir va a decir donde esta acto
  // seguido, y eso necesita el evento que acaba de crear, asi que se espera a que llegue.
  await waitUntilTheBeaconArrives(client, conversationId, sharedBy);
  return {
    // El identificador es la propia clave de estado: quien comparte, en esta conversacion.
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

/** Parar es reescribir el estado con `live: false`, conservando lo demas para que siga leyendose el historial. */
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

/** `geo:43.26,-2.93` es como el protocolo dice un sitio, y es lo que hay que deshacer para volver a numeros. */
function parseGeoUri(uri: string): GeoLocation | undefined {
  const [latitude, longitude] = uri.replace(/^geo:/, "").split(";")[0]?.split(",").map(Number) ?? [];
  const isSomewhere = Number.isFinite(latitude) && Number.isFinite(longitude);
  return isSomewhere ? { latitude: latitude as number, longitude: longitude as number } : undefined;
}
