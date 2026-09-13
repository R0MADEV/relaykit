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
