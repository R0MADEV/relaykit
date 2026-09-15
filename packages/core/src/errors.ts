/**
 * Everything that can go wrong, said the same way whatever is underneath.
 *
 * This list is the promise: an application branches on these and never on what a homeserver called it. A code
 * is added here only when an application would do something different because of it — a list that mirrors a
 * protocol's own error codes is that protocol leaking through a different door.
 */
export type RelayKitErrorCode =
  /** The client has not been started, or was started twice. The caller's own sequencing. */
  | "NOT_STARTED"
  | "ALREADY_STARTED"
  | "NOT_CONFIGURED"
  /** The session is no longer good. Sign in again; nothing else will work until then. */
  | "INVALID_SESSION"
  /** What was asked for cannot be right, and was refused here rather than sent. */
  | "INVALID_INPUT"
  | "MESSAGE_NOT_FOUND"
  | "CONVERSATION_NOT_FOUND"
  | "VERIFICATION_NOT_FOUND"
  /** Signed in, and not allowed to do this. Asking again will not help; something has to change first. */
  | "FORBIDDEN"
  /** Asked for something this kind of call or this homeserver does not do. Not a mistake by the caller. */
  | "NOT_SUPPORTED"
  /** Told to slow down. `retryAfterMs` says for how long, when the server said. */
  | "RATE_LIMITED"
  | "USERNAME_TAKEN"
  | "REGISTRATION_UNSUPPORTED"
  /** The server could not be reached. Worth trying again, and nothing is known about whether it happened. */
  | "NETWORK_ERROR"
  /**
   * Writing to, or emptying, the local copy failed. Almost always the browser refusing.
   *
   * Almost everything about the local copy is a convenience and its failures are swallowed; this exists for
   * the one that is not — being told to leave a device and not managing to take the conversations off it.
   */
  | "STORAGE_ERROR"
  /**
   * The backend failed in a way this library has no better name for.
   *
   * Nothing to branch on: show something general and log `detail`. Every one of these that turns out to be
   * worth acting on differently becomes a code of its own instead of staying in here.
   */
  | "ADAPTER_ERROR";

/** Everything else a failure can carry. Kept apart from the message, which is the part that never moves. */
export interface RelayKitErrorOptions {
  /** Only for `RATE_LIMITED`: how long the server asked this client to wait. */
  readonly retryAfterMs?: number;
  /**
   * What the backend said, word for word, when it said anything.
   *
   * For a log and for a bug report, never for a screen and never to branch on: it is whatever the server
   * happened to write, in whatever language, and it changes without warning. Which is exactly why it is kept
   * apart from `message` rather than mixed into it.
   */
  readonly detail?: string;
}

/**
 * The only kind of error this library throws.
 *
 * Whoever catches one never has to know what is underneath: `code` comes from the list above and `message` is
 * written here, in these words, and does not change because a homeserver changed its wording.
 */
export class RelayKitError extends Error {
  readonly name = "RelayKitError";
  /** Only for `RATE_LIMITED`: how long the server asked this client to wait. */
  readonly retryAfterMs: number | undefined;
  /** Opaque backend text, for logs only. */
  readonly detail: string | undefined;

  constructor(
    readonly code: RelayKitErrorCode,
    message: string,
    options: RelayKitErrorOptions = {}
  ) {
    super(message);
    this.retryAfterMs = options.retryAfterMs;
    this.detail = options.detail;
  }
}
