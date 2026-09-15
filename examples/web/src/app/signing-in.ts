import { MessagingClient, type Session } from "@relaykit/web";
import { element, input, onClick, onSubmit, pressedIn, safe } from "./dom.js";

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
    // Which ways in there are depends on which homeserver was typed, so they are asked for again when it is.
    input("homeserver").addEventListener("change", () => void drawWaysIn(this.client, this.wentWrong));
    onClick("as-guest", () => void this.signInAsGuest());
  }

  /** Opening it again with a session already here: straight in, without asking anything. */
  async reopen(): Promise<void> {
    // Just back from signing in somewhere else, with the one-time token in the address.
    const cameBack = tokenInTheAddress();
    if (cameBack) {
      try {
        const session = await this.client.sso.finish(cameBack.homeserver, cameBack.token);
        forgetTheToken();
        localStorage.setItem(remembered, JSON.stringify(session));
        await this.entered(session);
        return;
      } catch (error) {
        forgetTheToken();
        this.wentWrong(error);
      }
    }
    const kept = readSession();
    if (!kept) {
      element("sign-in").hidden = false;
      void drawWaysIn(this.client, this.wentWrong);
      return;
    }
    await this.entered(kept).catch(error => {
      // A session that is no longer good is not worth keeping, and the form is the way back in.
      localStorage.removeItem(remembered);
      element("sign-in").hidden = false;
      void drawWaysIn(this.client, this.wentWrong);
      this.wentWrong(error);
    });
  }

  /**
   * Coming in without an account, where the homeserver lets anybody in.
   *
   * No button is drawn for it conditionally the way the other ways in are, because Matrix has nothing to ask:
   * whether guests are allowed is only ever answered by being refused, so the refusal is what is shown.
   */
  private async signInAsGuest(): Promise<void> {
    try {
      const session = await this.client.signInAsGuest(input("homeserver").value.trim());
      localStorage.setItem(remembered, JSON.stringify(session));
      await this.entered(session);
    } catch (error) {
      this.wentWrong(error);
    }
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

/**
 * The way out: the session goes, and the page starts over.
 *
 * Reloading rather than unpicking what a running application has on screen. Signing out is rare, and a
 * client that is stopped is not a client anybody should be shown the inside of.
 */
export function forgetAndStartOver(): void {
  localStorage.removeItem(remembered);
  location.reload();
}

/**
 * The ways in this homeserver takes besides a password.
 *
 * Asked of the homeserver in the box, because which ones there are depends on which homeserver it is. A
 * button is only drawn for one that exists: sending somebody to a flow the server does not offer is a dead
 * end they cannot come back from.
 */
export async function drawWaysIn(
  client: MessagingClient,
  wentWrong: (error: unknown) => void
): Promise<void> {
  const where = element("ways-in");
  const list = element("ways-in-list");
  const homeserver = input("homeserver").value.trim();
  where.hidden = true;
  if (!homeserver) return;
  const waysIn = await client.sso.waysIn(homeserver).catch(() => []);
  if (waysIn.length === 0) return;
  list.innerHTML = waysIn
    .map(
      wayIn =>
        `<button class="button" type="button" data-way-in="${safe(wayIn.id)}">Entrar con ${safe(wayIn.name)}</button>`
    )
    .join("");
  where.hidden = false;
  list.onclick = event => {
    const wayIn = pressedIn(event, "way-in");
    if (wayIn === undefined) return;
    void goThere(client, homeserver, wayIn, wentWrong);
  };
}

/** Leaving the page on purpose: the homeserver sends the browser back here with a one-time token. */
async function goThere(
  client: MessagingClient,
  homeserver: string,
  wayIn: string,
  wentWrong: (error: unknown) => void
): Promise<void> {
  try {
    // Where to come back to is this page without the token of a previous attempt on it.
    const comeBackTo = new URL(location.href);
    comeBackTo.searchParams.delete(tokenComesBackAs);
    localStorage.setItem(cameBackFrom, homeserver);
    location.assign(await client.sso.startAt(homeserver, comeBackTo.toString(), wayIn || undefined));
  } catch (error) {
    wentWrong(error);
  }
}

/** What Matrix calls the one-time token when it bounces the browser back. */
const tokenComesBackAs = "loginToken";
/** Which homeserver was being signed in to, kept across the round trip out of the page. */
const cameBackFrom = "deitu-sign-in-at";

/** The token in the address, when the browser has just come back from signing in elsewhere. */
export function tokenInTheAddress(): { homeserver: string; token: string } | undefined {
  const token = new URLSearchParams(location.search).get(tokenComesBackAs);
  const homeserver = localStorage.getItem(cameBackFrom);
  if (!token || !homeserver) return undefined;
  return { homeserver, token };
}

/** Taken out of the address once spent: a one-time token left in a URL is one somebody can share by accident. */
export function forgetTheToken(): void {
  localStorage.removeItem(cameBackFrom);
  const address = new URL(location.href);
  address.searchParams.delete(tokenComesBackAs);
  history.replaceState(null, "", address.toString());
}
