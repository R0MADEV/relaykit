import { createClient, SSOAction, type MatrixClient } from "matrix-js-sdk";
import { SdkError, type Session, type SsoAdapter, type WayIn } from "@relaykit/core";
import { withTranslatedErrors } from "./matrix-errors.js";

/**
 * Signing in somewhere else and coming back: an organisation's single sign-on, Google, GitHub.
 *
 * All three of these happen **before there is a session**, so none of them can use the client the adapter
 * runs on — there is not one yet. Each makes a client of its own for the homeserver it was named, which is
 * what `matrix-js-sdk` is for: none of the three addresses is written out here.
 */
export class MatrixSso implements SsoAdapter {
  /**
   * What this homeserver takes besides a password.
   *
   * A homeserver that offers single sign-on without naming any provider still offers one way in — itself —
   * so it is said as one, because a screen with no button cannot send anybody anywhere.
   */
  async listWaysIn(homeserver: string): Promise<readonly WayIn[]> {
    return withTranslatedErrors(async () => {
      const { flows } = await forHomeserver(homeserver).loginFlows();
      const sso = flows.filter(flow => flow.type === "m.login.sso" || flow.type === "m.login.cas");
      if (sso.length === 0) return [];
      const named = sso.flatMap(flow =>
        "identity_providers" in flow ? (flow.identity_providers ?? []) : []
      );
      if (named.length === 0) return [{ id: "", name: "Single sign-on" }];
      return named.map(provider => ({
        id: provider.id,
        name: provider.name,
        ...(provider.brand ? { brand: provider.brand } : {}),
        ...(provider.icon ? { icon: provider.icon } : {})
      }));
    });
  }

  /**
   * Where to send the browser.
   *
   * Built by the SDK and not written out here: which prefix the redirect lives under, how the address it
   * comes back to is carried, and whether a named provider goes in the path are all the protocol's business.
   */
  async wayInAddress(homeserver: string, comeBackTo: string, wayInId?: string): Promise<string> {
    return withTranslatedErrors(async () => {
      // Asked first, because an address can be built for a way in the homeserver does not offer and it goes
      // nowhere. One more round trip, at the moment somebody is about to leave the page anyway, buys a
      // button that cannot be dead.
      const waysIn = await this.listWaysIn(homeserver);
      if (waysIn.length === 0) {
        throw new SdkError("NOT_SUPPORTED", "This homeserver offers no way in but a password");
      }
      return forHomeserver(homeserver).getSsoLoginUrl(
        comeBackTo,
        "sso",
        wayInId || undefined,
        SSOAction.LOGIN
      );
    });
  }

  /** The one-time token the homeserver bounced back with, spent for a session. */
  async signInWithToken(homeserver: string, token: string): Promise<Session> {
    return withTranslatedErrors(async () => {
      const client = forHomeserver(homeserver);
      const answer = await client.loginWithToken(token);
      return {
        homeserver,
        userId: answer.user_id,
        accessToken: answer.access_token,
        ...(answer.device_id ? { deviceId: answer.device_id } : {})
      };
    });
  }
}

/** A client for a homeserver nobody is signed in to yet, which is all these three need. */
function forHomeserver(homeserver: string): MatrixClient {
  return createClient({ baseUrl: homeserver });
}
