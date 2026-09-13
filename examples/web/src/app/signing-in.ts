import { MessagingClient, type Session } from "@relaykit/web";
import { element, input, onSubmit } from "./dom.js";

/** Where this example keeps the session, so opening it again does not ask who you are. */
const remembered = "deitu-session";

/**
 * Getting in: the form, the session kept from last time, and the client built around whichever of the two
 * answered. Everything else takes a session for granted, which is what this is here to make true.
 */
export class SigningIn {
  readonly client = buildClient();

  constructor(
    private readonly entered: (session: Session) => Promise<void>,
    private readonly wentWrong: (error: unknown) => void
  ) {
    onSubmit("sign-in", () => void this.signIn());
  }

  /** Opening it again with a session already here: straight in, without asking anything. */
  async reopen(): Promise<void> {
    const kept = readSession();
    if (!kept) {
      element("sign-in").hidden = false;
      return;
    }
    await this.entered(kept).catch(error => {
      // A session that is no longer good is not worth keeping, and the form is the way back in.
      localStorage.removeItem(remembered);
      element("sign-in").hidden = false;
      this.wentWrong(error);
    });
  }

  private async signIn(): Promise<void> {
    try {
      const session = await this.client.login({
        homeserver: input("homeserver").value.trim(),
        username: input("username").value.trim(),
        password: input("password").value
      });
      localStorage.setItem(remembered, JSON.stringify(session));
      await this.entered(session);
    } catch (error) {
      this.wentWrong(error);
    }
  }
}

function buildClient(): MessagingClient {
  const kept = readSession();
  const session = kept ? { session: kept } : {};
  return new MessagingClient({
    ...session,
    // A window over the conversations instead of every room: on an account with thousands, opening at once.
    matrix: { conversationWindow: 40, ...whereConferencesAreCarried() }
  });
}

/**
 * A development homeserver has no `.well-known` to say where its conferences are carried, so the address this
 * was opened with can say it instead. Only on a machine that is plainly a development one: where conferences
 * are carried is where this client sends its Matrix OpenID token, and a link somebody else wrote would point
 * that token at a server of their choosing.
 */
function whereConferencesAreCarried(): { conferenceServiceUrl?: string } {
  const isADevelopmentMachine = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (!isADevelopmentMachine) return {};
  const said = new URLSearchParams(location.search).get("conference");
  return { conferenceServiceUrl: said ?? "http://localhost:8091" };
}

function readSession(): Session | undefined {
  try {
    const kept = localStorage.getItem(remembered);
    if (!kept) return undefined;
    const parsed: unknown = JSON.parse(kept);
    return isSession(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Whatever is in local storage was put there by something; it is only a session if it looks like one. */
function isSession(value: unknown): value is Session {
  if (typeof value !== "object" || value === null) return false;
  const said: Partial<Record<keyof Session, unknown>> = value;
  const enough: readonly (keyof Session)[] = ["homeserver", "userId", "accessToken"];
  return enough.every(key => typeof said[key] === "string");
}
