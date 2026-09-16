import "./matrix-proposals.js";
import { createClient, type MatrixClient } from "matrix-js-sdk";
import type { AccountAdapter, AccountAddress, AddressProof, GuestsAdapter, Session } from "@relaykit/core";
import { withTranslatedErrors } from "./matrix-errors.js";

/**
 * The account itself: its password, its end, and whatever it remembers about itself.
 *
 * What it remembers is kept by the homeserver, so it is the same on every device this account signs in on —
 * which is the whole reason for it. Anything that only matters to one browser belongs in that browser.
 */
export class MatrixAccount implements AccountAdapter {
  constructor(
    private readonly client: () => MatrixClient,
    private readonly forgetWhatIsLeft: () => Promise<void>,
    /** Told when the refresh token this session was given stops being worth anything. */
    private readonly noLongerRefreshable: () => void
  ) {}

  /**
   * Changing the password, which the homeserver asks for the old one to do.
   *
   * It also throws away the refresh token that came with this session, because a password change is how
   * somebody shuts out whoever had the old one. Nobody is told that by the homeserver, so a session that
   * kept holding it would hold something already dead and find out at the worst moment.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await withTranslatedErrors(async () => {
      const client = this.client();
      await client.setPassword(
        {
          type: "m.login.password",
          identifier: { type: "m.id.user", user: client.getSafeUserId() },
          password: currentPassword
        },
        newPassword
      );
      this.noLongerRefreshable();
    });
  }

  /**
   * Whether a name is still free to register with.
   *
   * Before there is an account, like signing in, so it makes a client of its own for the homeserver it was
   * named. A homeserver that refuses to say treats the question as the answer: the name is not free.
   */
  async isUsernameFree(homeserver: string, username: string): Promise<boolean> {
    return createClient({ baseUrl: homeserver })
      .isUsernameAvailable(username)
      .catch(() => false);
  }

  /** What is gone is gone. The homeserver tells everybody, and nothing here can put it back. */
  async deactivateAccount(password: string): Promise<void> {
    await withTranslatedErrors(async () => {
      const client = this.client();
      await client.deactivateAccount({
        type: "m.login.password",
        identifier: { type: "m.id.user", user: client.getSafeUserId() },
        password
      });
    });
    // And the databases of an account that does not exist any more, which nothing else is going to come back
    // for. Said rather than thrown: the account is gone whether or not the browser lets go of them.
    await this.forgetWhatIsLeft();
  }

  async listAddresses(): Promise<readonly AccountAddress[]> {
    return withTranslatedErrors(async () => {
      const { threepids } = await this.client().getThreePids();
      return threepids
        .filter(each => each.medium === "email" || each.medium === "msisdn")
        .map(each => ({
          kind: each.medium === "email" ? ("email" as const) : ("phone" as const),
          address: each.address,
          ...(each.validated_at ? { provedAt: each.validated_at } : {})
        }));
    });
  }

  /**
   * Starts adding an address: the homeserver sends something to it.
   *
   * Nothing is added yet, and that is the point. Anyone can type another person's address; only the person
   * reading what arrives there can prove it is theirs, which is what the second step is for.
   *
   * The secret is made here and never leaves this side except to the homeserver, which is what stops somebody
   * who guesses the request's name from finishing it.
   */
  async startAddingEmail(email: string): Promise<AddressProof> {
    return withTranslatedErrors(async () => {
      const secret = this.client().generateClientSecret();
      const { sid } = await this.client().requestAdd3pidEmailToken(email, secret, 1);
      return { id: sid, secret };
    });
  }

  async finishAddingAddress(proof: AddressProof, password: string): Promise<void> {
    await withTranslatedErrors(async () => {
      const client = this.client();
      const auth = {
        type: "m.login.password",
        identifier: { type: "m.id.user", user: client.getSafeUserId() },
        password
      };
      await client.addThreePidOnly({ sid: proof.id, client_secret: proof.secret, auth });
    });
  }

  async removeAddress(kind: "email" | "phone", address: string): Promise<void> {
    await withTranslatedErrors(async () => {
      await this.client().deleteThreePid(kind === "email" ? "email" : "msisdn", address);
    });
  }

  /**
   * A way back into an account whose password is forgotten.
   *
   * Its own client, because there is no session: somebody locked out has nothing to sign in with, and the
   * address they once proved is theirs is the only thing left that says who they are.
   */
  async startResettingPassword(homeserver: string, email: string): Promise<AddressProof> {
    return withTranslatedErrors(async () => {
      const client = createClient({ baseUrl: homeserver });
      const secret = client.generateClientSecret();
      const { sid } = await client.requestPasswordEmailToken(email, secret, 1);
      return { id: sid, secret };
    });
  }

  async finishResettingPassword(homeserver: string, proof: AddressProof, newPassword: string): Promise<void> {
    await withTranslatedErrors(async () => {
      // Every other session is closed: a password is reset because somebody could not get in, and whoever
      // could was not necessarily them.
      await createClient({ baseUrl: homeserver }).setPassword(
        {
          type: "m.login.email.identity",
          threepid_creds: { sid: proof.id, client_secret: proof.secret }
        },
        newPassword,
        true
      );
    });
  }

  async rememberSetting(name: string, value: Readonly<Record<string, unknown>>): Promise<void> {
    await withTranslatedErrors(async () => {
      const all = await this.everythingRemembered();
      await this.client().setAccountData(settingsLiveUnder, { ...all, [name]: { ...value } });
    });
  }

  /**
   * Read from what the sync already holds, and from the homeserver only when it holds nothing.
   *
   * A setting written on another device arrives with the sync like everything else; asking the homeserver
   * every time would be a request for something already in hand.
   */
  async rememberedSetting(name: string): Promise<Readonly<Record<string, unknown>> | undefined> {
    return withTranslatedErrors(async () => (await this.everythingRemembered())[name]);
  }

  /**
   * Everything this account remembers, from what the sync already holds.
   *
   * A setting written on another device arrives with the sync like anything else; the homeserver is only
   * asked when the sync is holding nothing at all, which is the first read after signing in.
   */
  private async everythingRemembered(): Promise<Record<string, Record<string, unknown>>> {
    const held = this.client().getAccountData(settingsLiveUnder)?.getContent();
    if (held) return held;
    const asked = await this.client()
      .getAccountDataFromServer(settingsLiveUnder)
      .catch(() => null);
    return asked ?? {};
  }
}

/**
 * Coming in without an account.
 *
 * Before there is a session, like signing in elsewhere, so it makes a client of its own for the homeserver
 * it was named. Most homeservers refuse, and being refused is the ordinary answer.
 */
export class MatrixGuests implements GuestsAdapter {
  async signInAsGuest(homeserver: string): Promise<Session> {
    return withTranslatedErrors(async () => {
      const answer = await createClient({ baseUrl: homeserver }).registerGuest({});
      return {
        homeserver,
        userId: answer.user_id,
        accessToken: answer.access_token ?? "",
        isGuest: true,
        ...(answer.device_id ? { deviceId: answer.device_id } : {})
      };
    });
  }
}

/** Namespaced to this library, so an application's own names cannot collide with the protocol's. */
const settingsLiveUnder = "dev.relaykit.settings";
