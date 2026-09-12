export type SdkErrorCode =
  | "NOT_STARTED"
  | "ALREADY_STARTED"
  | "NOT_CONFIGURED"
  | "INVALID_SESSION"
  | "INVALID_INPUT"
  | "MESSAGE_NOT_FOUND"
  | "CONVERSATION_NOT_FOUND"
  | "VERIFICATION_NOT_FOUND"
  | "ADAPTER_ERROR"
  | "RATE_LIMITED"
  | "USERNAME_TAKEN"
  | "REGISTRATION_UNSUPPORTED";

export class SdkError extends Error {
  readonly name = "SdkError";

  constructor(
    readonly code: SdkErrorCode,
    message: string,
    /** Only set for `RATE_LIMITED`: how long the homeserver asked the client to wait. */
    readonly retryAfterMs?: number
  ) {
    super(message);
  }
}
