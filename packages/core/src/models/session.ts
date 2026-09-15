import type { UserId } from "./ids.js";

export interface Session {
  readonly homeserver: string;
  readonly userId: UserId;
  readonly accessToken: string;
  readonly deviceId?: string;
  /**
   * Came in without an account.
   *
   * Worth carrying because a guest is not a small account: the homeserver refuses it its keys and its
   * notification rules, so a session that starts as if it were one spends its first seconds being told no.
   */
  readonly isGuest?: boolean;
  /**
   * Used once, to ask the homeserver for a new access token when this one runs out.
   *
   * Kept with the session because it is no use apart from it, and because a homeserver that hands out short
   * tokens hands out one of these with every one of them.
   */
  readonly refreshToken?: string;
  /** When the access token stops working, if the homeserver said. */
  readonly expiresAt?: number;
}

export interface RegisterCredentials {
  readonly homeserver: string;
  readonly username: string;
  readonly password: string;
  readonly deviceName?: string;
}

export interface LoginCredentials {
  readonly homeserver: string;
  readonly username: string;
  readonly password: string;
  readonly deviceName?: string;
}

export interface SignOutOptions {
  /** Homeservers ask for the password again before closing other sessions. */
  readonly password?: string;
}

/**
 * A way into an account that is not a password: an organisation's single sign-on, or Google, or GitHub.
 *
 * The homeserver says which it offers. What a screen does with it — a button with a name and a logo — is its
 * own business; what it must do is send the browser where `startAt` says and come back with the token.
 */
export interface WayIn {
  readonly id: string;
  readonly name: string;
  /** Which one it is, when the homeserver says: `google`, `github`, `apple`… A screen can draw a logo. */
  readonly brand?: string;
  /** A picture the homeserver offers for it, downloadable with `media.download`. */
  readonly icon?: string;
}

/** An email address or a phone number an account answers to, besides the name it signed up with. */
export interface AccountAddress {
  readonly kind: "email" | "phone";
  readonly address: string;
  /** When the person proved it was theirs. */
  readonly provedAt?: number;
}

/**
 * A request sent to an address, waiting to be proved.
 *
 * Two halves and no more: the homeserver's name for the request, and a secret this side made up for it. Both
 * are needed to finish, and neither is any use alone — which is what stops somebody else finishing it.
 */
export interface AddressProof {
  readonly id: string;
  readonly secret: string;
}
