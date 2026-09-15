import { RelayKitError } from "./errors.js";
import type { AccountAdapter, MessagingAdapter } from "./adapter.js";
import type { AccountAddress, AddressProof } from "./models.js";

export interface AccountOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
  /** Stops the client and lets go of the session and the local copy, for when the account itself is gone. */
  readonly nothingLeftToBe: () => Promise<void>;
}

/**
 * The account itself: its password, its end, and whatever it wants to remember about itself.
 *
 * Apart from everything else because none of it is messaging. What is kept here is kept by the homeserver
 * and read back on any device, which is what makes it different from anything the application writes down
 * locally: a theme chosen on a laptop is the theme on the phone too.
 */
export class AccountOperations {
  constructor(private readonly context: AccountOperationsContext) {}

  /** The old one is asked for by the homeserver, so somebody who walked away from a screen cannot be locked out. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    this.context.assertStarted();
    if (!currentPassword) {
      throw new RelayKitError("INVALID_INPUT", "The current password is required");
    }
    if (newPassword.length < 8) {
      throw new RelayKitError("INVALID_INPUT", "A password must be at least eight characters");
    }
    await this.account.changePassword(currentPassword, newPassword);
  }

  /**
   * Ends the account.
   *
   * Not leaving a conversation and not signing out: what is gone is gone, the homeserver tells everybody so,
   * and nothing here can put it back. The password is asked for because it cannot be undone.
   */
  async close(password: string): Promise<void> {
    this.context.assertStarted();
    if (!password) {
      throw new RelayKitError("INVALID_INPUT", "The password is required to close an account");
    }
    await this.account.deactivateAccount(password);
    // And then this client is over. Leaving it running leaves a session worth nothing, a sync that will be
    // refused, and a copy of conversations nobody can ever open again — until some later request happens to
    // find out. Whoever just deleted their account should not have to wait for that.
    await this.context.nothingLeftToBe();
  }

  /** Something this account remembers about itself: a theme, a layout, whatever the application decides. */
  async remember(name: string, value: Readonly<Record<string, unknown>>): Promise<void> {
    this.context.assertStarted();
    await this.account.rememberSetting(requireName(name), value);
  }

  /** Nothing is a real answer: it means this account has never been told. */
  async remembered(name: string): Promise<Readonly<Record<string, unknown>> | undefined> {
    this.context.assertStarted();
    return this.account.rememberedSetting(requireName(name));
  }

  /** The addresses this account answers to, besides the name it signed up with. */
  async addresses(): Promise<readonly AccountAddress[]> {
    this.context.assertStarted();
    return this.account.listAddresses();
  }

  /**
   * Starts adding an email address, which sends something to it.
   *
   * Two steps because an address nobody proved is an address somebody else typed: anyone could claim another
   * person's, and a homeserver that took their word for it would let them be found by it.
   */
  async addEmail(email: string): Promise<AddressProof> {
    this.context.assertStarted();
    return this.account.startAddingEmail(requireEmail(email));
  }

  /**
   * Finishes it, once the person has proved the address is theirs. Refuses if they have not.
   *
   * The password is asked for again by the homeserver: an address is how an account is found and how its
   * password is reset, so it is not something an open screen left unattended should be able to change.
   */
  async confirmEmail(proof: AddressProof, password: string): Promise<void> {
    this.context.assertStarted();
    if (!password) {
      throw new RelayKitError("INVALID_INPUT", "The password is required to add an address");
    }
    await this.account.finishAddingAddress(proof, password);
  }

  async removeAddress(kind: "email" | "phone", address: string): Promise<void> {
    this.context.assertStarted();
    if (!address.trim()) {
      throw new RelayKitError("INVALID_INPUT", "An address is required");
    }
    await this.account.removeAddress(kind, address.trim());
  }

  /**
   * A way back into an account whose password is forgotten.
   *
   * Before there is a session, because the whole point is that there cannot be one: somebody locked out has
   * nothing to sign in with, and the address they proved is theirs is the only thing left that says who they
   * are.
   */
  async startResettingPassword(homeserver: string, email: string): Promise<AddressProof> {
    if (!homeserver.trim()) {
      throw new RelayKitError("INVALID_INPUT", "A homeserver address is required");
    }
    return this.account.startResettingPassword(homeserver.trim(), requireEmail(email));
  }

  async finishResettingPassword(homeserver: string, proof: AddressProof, newPassword: string): Promise<void> {
    if (newPassword.length < 8) {
      throw new RelayKitError("INVALID_INPUT", "A password must be at least eight characters");
    }
    await this.account.finishResettingPassword(homeserver.trim(), proof, newPassword);
  }

  /** The one place that answers whether this adapter does this at all. */
  private get account(): AccountAdapter {
    const found = this.context.adapter.account;
    if (!found) {
      throw new RelayKitError("NOT_SUPPORTED", "Managing the account is not something this homeserver has");
    }
    return found;
  }
}

/**
 * Something shaped like an address, checked here rather than by the homeserver.
 *
 * Not a full address check, which nothing can do without sending to it — that is what the second step is. It
 * catches the typo, so a person is told at once instead of waiting for a message that was never going to come.
 */
function requireEmail(email: string): string {
  const looksLikeOne = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  if (!looksLikeOne) {
    throw new RelayKitError("INVALID_INPUT", "That does not look like an email address");
  }
  return email.trim();
}

/** A setting nobody named is a setting nobody can read back. */
function requireName(name: string): string {
  if (!name.trim()) {
    throw new RelayKitError("INVALID_INPUT", "A setting name is required");
  }
  return name.trim();
}
