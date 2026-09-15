import type { Session } from "@relaykit/core";

/** What a homeserver answers when it renews a token. Only the parts this has to decide from. */
export interface WhatARenewalSaid {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_in_ms?: number;
}

/**
 * The session after a token was renewed.
 *
 * Kept apart from the asking, because it is the part that is easy to get wrong and impossible to see: a
 * client can present a token two renewals out of date and work perfectly until the moment it does not.
 *
 * Two rules, and both of them have caught something:
 *
 * It is built from the session as it is *now*, never from a copy taken when the client started. The one held
 * at the start has the first refresh token in it, and renewals happen for as long as the session lasts.
 *
 * And when the answer carries no refresh token, the one just used is still good and stays — that is what the
 * protocol says. Carrying forward whatever the session happened to hold is how it goes backwards.
 */
export function theSessionAfterRefreshing(current: Session, said: WhatARenewalSaid, used: string): Session {
  const runsOutAt = said.expires_in_ms === undefined ? undefined : Date.now() + said.expires_in_ms;
  // Rebuilt rather than spread over, so an expiry from the previous one cannot survive into a renewal that
  // did not mention one.
  const { expiresAt, ...rest } = current;
  return {
    ...rest,
    accessToken: said.access_token,
    refreshToken: said.refresh_token ?? used,
    ...(runsOutAt === undefined ? {} : { expiresAt: runsOutAt })
  };
}
