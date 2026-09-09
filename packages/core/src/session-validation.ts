import { SdkError } from "./errors.js";
import type { LoginCredentials, Session } from "./models.js";

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
