import type { CallQuality } from "@relaykit/core";

/**
 * How a call is going, read off what the browser reports about the connection. Kept apart from the call
 * itself because it is about the browser's report and nothing else: which entries of it are worth reading,
 * and what in them is worth a number.
 */
export function qualityFrom(reported: readonly RTCStats[]): CallQuality {
  const heard = reported.find(isSoundArriving);
  const path = reported.find(isTheChosenPath);
  const jitterSeconds = heard?.jitter;
  const tripSeconds = path?.currentRoundTripTime;
  const packetsLost = heard?.packetsLost;
  return {
    ...(packetsLost === undefined ? {} : { packetsLost }),
    ...(jitterSeconds === undefined ? {} : { jitterMs: Math.round(jitterSeconds * 1000) }),
    ...(tripSeconds === undefined ? {} : { roundTripMs: Math.round(tripSeconds * 1000) })
  };
}

/** A report is not an array however much it behaves like one, so what it offers is being walked. */
export function statsIn(reported: RTCStatsReport | undefined): readonly RTCStats[] {
  if (!reported) return [];
  const stats: RTCStats[] = [];
  reported.forEach(stat => stats.push(stat));
  return stats;
}

/** The sound coming in, which is the entry whose losses and jitter are the ones somebody hears. */
function isSoundArriving(stat: RTCStats): stat is RTCInboundRtpStreamStats {
  return stat.type === "inbound-rtp" && "kind" in stat && stat.kind === "audio";
}

/** The pair of addresses the browser settled on, which is the one whose round trip means anything. */
function isTheChosenPath(stat: RTCStats): stat is RTCIceCandidatePairStats {
  return stat.type === "candidate-pair" && "nominated" in stat && stat.nominated === true;
}
