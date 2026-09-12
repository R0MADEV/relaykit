import { SdkError } from "./errors.js";
import type { LoginCredentials, RegisterCredentials, Session } from "./models.js";

export function validateRegisterCredentials(credentials: RegisterCredentials): void {
  if (!credentials.homeserver.trim()) {
    throw new SdkError("INVALID_INPUT", "A homeserver is required");
  }
  if (!credentials.username.trim()) {
    throw new SdkError("INVALID_INPUT", "A username is required");
  }
  if (!credentials.password.trim()) {
    throw new SdkError("INVALID_INPUT", "A password is required");
  }
}

export function validateLoginCredentials(credentials: LoginCredentials): void {
  const hasEmptyValue = [credentials.homeserver, credentials.username, credentials.password]
    .some(value => !value.trim());
  if (hasEmptyValue) {
    throw new SdkError("INVALID_SESSION", "Homeserver, username and password are required");
  }
}

export function validateSession(session: Session): void {
  const hasEmptyValue = [session.homeserver, session.userId, session.accessToken]
    .some(value => !value.trim());
  if (hasEmptyValue) {
    throw new SdkError("INVALID_SESSION", "Homeserver, user ID and access token are required");
  }
}
