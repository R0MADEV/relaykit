import type { CallQuality } from "@relaykit/core";

/**
 * How a call is going, read off what the browser reports about the connection. Kept apart from the call
 * itself because it is about the browser's report and nothing else: the shape of that report, and what in it
 * is worth a number.
 */
export function qualityFrom(reported: readonly unknown[]): CallQuality {
  const stats = reported.filter(isAnObject);
  const heard = stats.find(isSoundArriving);
  const path = stats.find(isTheChosenPath);
  const packetsLost = numberFrom(heard, stat => ("packetsLost" in stat ? stat.packetsLost : undefined));
  const jitterSeconds = numberFrom(heard, stat => ("jitter" in stat ? stat.jitter : undefined));
  const tripSeconds = numberFrom(path, stat =>
    "currentRoundTripTime" in stat ? stat.currentRoundTripTime : undefined
  );
  return {
    ...(packetsLost === undefined ? {} : { packetsLost }),
    ...(jitterSeconds === undefined ? {} : { jitterMs: Math.round(jitterSeconds * 1000) }),
    ...(tripSeconds === undefined ? {} : { roundTripMs: Math.round(tripSeconds * 1000) })
  };
}

/** A report is not an array however much it behaves like one, so what it offers is being walked. */
export function statsIn(reported: RTCStatsReport | undefined): readonly unknown[] {
  if (!reported) return [];
  const stats: unknown[] = [];
  reported.forEach(stat => stats.push(stat));
  return stats;
}

function isAnObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isSoundArriving(stat: object): boolean {
  if (!("type" in stat) || stat.type !== "inbound-rtp") return false;
  return "kind" in stat && stat.kind === "audio";
}

/** The pair of addresses the browser settled on, which is the one whose round trip means anything. */
function isTheChosenPath(stat: object): boolean {
  if (!("type" in stat) || stat.type !== "candidate-pair") return false;
  return "nominated" in stat && stat.nominated === true;
}

/** What the browser reports is not typed, so a number is only a number once it has been looked at. */
function numberFrom(stat: object | undefined, read: (stat: object) => unknown): number | undefined {
  if (!stat) return undefined;
  const value = read(stat);
  if (typeof value !== "number") return undefined;
  return value;
}
