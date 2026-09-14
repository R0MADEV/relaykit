import { SdkError, type Session, type SsoAdapter, type WayIn } from "@relaykit/core";

/**
 * Signing in somewhere else, pretended convincingly enough to be worth testing against.
 *
 * There is nowhere to send a browser here, so the address it hands back carries the token it would have come
 * back with. That is the whole shape of the real thing: somebody goes away, comes back with a one-time token,
 * and the token is spent for a session. A token nobody issued is refused, because that is the part that
 * matters and the part a mistake would quietly skip.
 */
export class InMemorySso implements SsoAdapter {
  private offered: readonly WayIn[] = [];
  private readonly issued = new Set<string>();
  private nextToken = 1;

  constructor(private readonly context: { readonly signIn: (userId: string) => Session }) {}

  /** Test helper: what this homeserver pretends to offer besides a password. */
  offer(waysIn: readonly WayIn[]): void {
    this.offered = [...waysIn];
  }

  async listWaysIn(): Promise<readonly WayIn[]> {
    return this.offered;
  }

  async wayInAddress(homeserver: string, comeBackTo: string, wayInId?: string): Promise<string> {
    const going = this.offered.find(each => each.id === wayInId) ?? this.offered[0];
    if (!going) {
      throw new SdkError("NOT_SUPPORTED", "This homeserver offers no way in but a password");
    }
    const token = `memory-sso-${this.nextToken++}`;
    this.issued.add(token);
    const address = new URL(comeBackTo);
    address.searchParams.set("way-in", going.id);
    // Where a real homeserver would put it once the browser came back.
    address.searchParams.set("pretend-token", token);
    return address.toString();
  }

  async signInWithToken(homeserver: string, token: string): Promise<Session> {
    if (!this.issued.delete(token)) {
      throw new SdkError("INVALID_INPUT", "That sign in token was not issued here");
    }
    return this.context.signIn(`memory-user-${token}`);
  }
}
