import type { UserId } from "./ids.js";

export interface Session {
  readonly homeserver: string;
  readonly userId: UserId;
  readonly accessToken: string;
  readonly deviceId?: string;
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
