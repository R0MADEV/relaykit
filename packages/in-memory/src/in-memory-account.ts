import {
  SdkError,
  type AccountAdapter,
  type AccountAddress,
  type AddressProof,
  type GuestsAdapter,
  type Session
} from "@relaykit/core";

/**
 * The account of the double: its password, its end, and what it remembers.
 *
 * The password matters here and the rest barely does: changing one without the old one is the mistake worth
 * catching, and it is the one a double that accepts anything would let through.
 */
export class InMemoryAccount implements AccountAdapter {
  private readonly settings = new Map<string, Record<string, unknown>>();
  private readonly addresses: AccountAddress[] = [];
  private readonly waiting = new Map<string, { kind: "email" | "phone"; address: string }>();
  private readonly proved = new Set<string>();
  private nextProof = 1;

  constructor(
    private readonly context: {
      readonly password: () => string;
      readonly changed: (to: string) => void;
    }
  ) {}

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    if (currentPassword !== this.context.password()) {
      throw new SdkError("INVALID_INPUT", "That is not the current password");
    }
    this.context.changed(newPassword);
  }

  async deactivateAccount(password: string): Promise<void> {
    if (password !== this.context.password()) {
      throw new SdkError("INVALID_INPUT", "That is not the current password");
    }
    this.settings.clear();
  }

  /**
   * Adding an address, in the two steps a homeserver takes.
   *
   * The double will not take anybody's word for it either: a request is made, and stays a request until the
   * test says the person proved it. Accepting it straight away would test nothing, since the half worth
   * getting right is the refusal.
   */
  async startAddingEmail(email: string): Promise<AddressProof> {
    const proof = { id: `memory-proof-${this.nextProof++}`, secret: `memory-secret-${this.nextProof}` };
    this.waiting.set(proof.id, { kind: "email", address: email });
    return proof;
  }

  async finishAddingAddress(proof: AddressProof, password: string): Promise<void> {
    if (password !== this.context.password()) {
      throw new SdkError("INVALID_INPUT", "That is not the current password");
    }
    const asked = this.waiting.get(proof.id);
    if (!asked || !this.proved.has(proof.id)) {
      throw new SdkError("INVALID_INPUT", "That address has not been proved yet");
    }
    this.addresses.push({ ...asked, provedAt: Date.now() });
    this.waiting.delete(proof.id);
    this.proved.delete(proof.id);
  }

  async listAddresses(): Promise<readonly AccountAddress[]> {
    return this.addresses;
  }

  async removeAddress(kind: "email" | "phone", address: string): Promise<void> {
    const at = this.addresses.findIndex(each => each.kind === kind && each.address === address);
    if (at >= 0) this.addresses.splice(at, 1);
  }

  async startResettingPassword(homeserver: string, email: string): Promise<AddressProof> {
    return this.startAddingEmail(email);
  }

  async finishResettingPassword(homeserver: string, proof: AddressProof, newPassword: string): Promise<void> {
    if (!this.proved.has(proof.id)) {
      throw new SdkError("INVALID_INPUT", "That address has not been proved yet");
    }
    this.proved.delete(proof.id);
    this.context.changed(newPassword);
  }

  /** Test helper: the person clicked the link in the message that was sent to them. */
  prove(proofId: string): void {
    this.proved.add(proofId);
  }

  async rememberSetting(name: string, value: Readonly<Record<string, unknown>>): Promise<void> {
    this.settings.set(name, { ...value });
  }

  async rememberedSetting(name: string): Promise<Readonly<Record<string, unknown>> | undefined> {
    return this.settings.get(name);
  }
}

/**
 * Coming in without an account. The double lets anybody in, because refusing is the part it cannot teach.
 *
 * It only hands back a session; whoever asked for it is the one that starts with it, here as on a homeserver.
 */
export class InMemoryGuests implements GuestsAdapter {
  private nextGuest = 1;

  async signInAsGuest(homeserver: string): Promise<Session> {
    return {
      homeserver,
      userId: `memory-guest-${this.nextGuest++}`,
      accessToken: "memory-guest-token",
      deviceId: "memory-guest-device"
    };
  }
}
