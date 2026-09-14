import type { MatrixClient } from "matrix-js-sdk";
import type { Participant, Track } from "livekit-client";
import type { ConversationId, UserId } from "@relaykit/core";

/**
 * What a call's memberships mean, read off them and nothing else.
 *
 * Apart from holding the call because this is the only half of it that can be answered without an SFU, a
 * browser or a homeserver — which is to say, the only half anybody can test. Who is on a call, which of
 * somebody's devices is the one still there, and whether a call is ringing or going on are all decided
 * here, from a list.
 */
/** What a membership says that a ringing screen needs: who, from which device, since when. */
export interface SaidToBeOnTheCall {
  readonly userId: string;
  readonly deviceId: string;
  createdTs(): number;
}
/**
 * The room says one entry per device, and a device that died without leaving stays said for hours. A screen
 * ringing for a call draws people, not the devices they have lost along the way: one per person, from
 * whichever of their devices spoke last, in the order the people arrived. Once inside, who is really
 * connected is known from the SFU and none of this is used.
 */
export function newestPerPerson<T extends SaidToBeOnTheCall>(memberships: readonly T[]): T[] {
  const newest = new Map<string, T>();
  // When each person first turned up, whichever device it was: that is the order a screen lists them in,
  // and it must not change because somebody opened a second device later.
  const arrived = new Map<string, number>();
  for (const member of memberships) {
    const known = newest.get(member.userId);
    if (!known || member.createdTs() > known.createdTs()) newest.set(member.userId, member);
    arrived.set(member.userId, Math.min(arrived.get(member.userId) ?? Infinity, member.createdTs()));
  }
  return [...newest.values()].sort(
    (one, other) => (arrived.get(one.userId) ?? 0) - (arrived.get(other.userId) ?? 0)
  );
}
/**
 * Who a screen ringing for a call shows: everybody but this account. What an older device of yours left
 * behind is not you, and while it rings you are not on it — and if your phone really is, you know.
 */
export function peopleOnARingingCall<T extends SaidToBeOnTheCall>(
  memberships: readonly T[],
  ownUserId: string
): T[] {
  return newestPerPerson(memberships.filter(member => member.userId !== ownUserId));
}
/** Whether a membership is this very device's, which is the one that must not ring for itself. */
export function isThisDevice(client: MatrixClient, member: { userId: string; deviceId: string }): boolean {
  return member.userId === client.getSafeUserId() && member.deviceId === client.getDeviceId();
}
/**
 * One conference per conversation, named after it. Deliberately not a random id: a second screen joining
 * has to arrive at the same call, and this is what makes rejoining find what is already going on.
 */
export function callIdFor(conversationId: ConversationId): string {
  return `conference:${conversationId}`;
}
/**
 * The SFU knows one string per participant and nothing else about them. The service that admits people puts
 * the Matrix user and their device in it, joined by a colon, and the SDK names key holders the same way.
 * `identityOf` writes it and `whoIs` reads it back — and a Matrix user id has colons of its own, so it is the
 * last one that separates them.
 */
export function identityOf(userId: UserId, deviceId: string): string {
  return `${userId}:${deviceId}`;
}
export function whoIs(identity: string): { userId: UserId; deviceId: string } {
  const separator = identity.lastIndexOf(":");
  const looksLikeAUserWithADevice = identity.startsWith("@") && separator > 0;
  if (!looksLikeAUserWithADevice) return { userId: identity, deviceId: "" };
  return { userId: identity.slice(0, separator), deviceId: identity.slice(separator + 1) };
}
/**
 * Handed over as a `MediaStream` rather than described, as everywhere else: a screen cannot play a boolean,
 * and this goes straight into the `srcObject` of an element.
 */
export function streamOf(
  participant: Participant,
  sources: readonly Track.Source[]
): MediaStream | undefined {
  const tracks = participant
    .getTrackPublications()
    .filter(publication => sources.includes(publication.source))
    .map(publication => publication.track?.mediaStreamTrack)
    .filter(track => track !== undefined);
  if (tracks.length === 0) return undefined;
  return new MediaStream(tracks);
}
