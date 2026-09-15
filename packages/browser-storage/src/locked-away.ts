import { RelayKitError } from "@relaykit/core";

/**
 * How many times a typed passphrase is put through the mill before it becomes a key.
 *
 * What OWASP recommends for PBKDF2-HMAC-SHA256 today. It is a number that only goes up, which is why how it
 * was derived is written down rather than assumed.
 */
const howHardToGuess = 600_000;

/** What was done to a secret to turn it into a key, kept so that changing it later can still open the old. */
export interface HowItWasDerived {
  readonly kdf: "sha256" | "pbkdf2-sha256";
  readonly version: number;
  readonly iterations: number;
  readonly salt?: string;
}

/** A secret that was already random needs nothing done to it but a digest. */
const straightFromRandomBytes: HowItWasDerived = { kdf: "sha256", version: 1, iterations: 1 };

/**
 * What this library writes in front of anything it sealed.
 *
 * A mark and a version, so that reading is a question with an answer instead of a guess, and so that the
 * next way of sealing something can live beside this one rather than replacing it everywhere at once.
 */
const sealedBy = "rk1:";

/**
 * Turning what is kept locally into bytes nobody else on this machine can read, and back.
 *
 * Apart from the store because it is a different subject: one is where records live and how they are found,
 * the other is that a record written with one key cannot be read with another — which is what makes a local
 * copy safe to leave behind and is the only part of this with a wrong answer.
 */
export class LockedAway {
  private key: Promise<CryptoKey> | undefined;
  private derivation: HowItWasDerived = straightFromRandomBytes;

  /**
   * Locked with a secret that is already random: the device secret, or an access token.
   *
   * One digest is enough for those — there is nothing to guess. It is the wrong answer for anything a person
   * typed, which is what `lockWithPassphrase` is for.
   *
   * Without a secret nothing is locked: the records go in as they are, which is what an open store is.
   */
  lockWith(secret: string | undefined): void {
    this.derivation = straightFromRandomBytes;
    this.key = secret === undefined ? undefined : this.createKey(secret);
    // Held onto until somebody asks for a record, so a failure is reported then and not as a rejection
    // nobody was listening for.
    this.key?.catch(() => undefined);
  }

  /**
   * Locked with something a person typed, which is a different problem.
   *
   * A passphrase has little entropy, so a single fast digest of it can be guessed offline at whatever rate
   * the attacker's hardware allows — and SHA-256 is fast on purpose. PBKDF2 makes each guess cost, and the
   * salt means the cost has to be paid again for every device instead of once for all of them.
   *
   * The salt is not a secret and is kept beside the data. What it prevents is one precomputation working
   * everywhere, and two copies under the same passphrase being the same bytes.
   */
  lockWithPassphrase(passphrase: string, salt: string): void {
    this.derivation = { kdf: "pbkdf2-sha256", version: 1, iterations: howHardToGuess, salt };
    this.key = this.createKeyFromPassphrase(passphrase, salt);
    this.key.catch(() => undefined);
  }

  /**
   * How the key in force was made.
   *
   * Written down beside the data so that raising the work factor later, or moving to another algorithm, can
   * still open what is already there instead of locking somebody out of their own copy.
   */
  howItWasDerived(): HowItWasDerived {
    return this.derivation;
  }

  isLocked(): boolean {
    return this.key !== undefined;
  }

  /**
   * Settles once the key is made, or fails with why it could not be.
   *
   * Whoever asked for encrypted storage is told at the door, rather than finding out on the first record
   * that happens to need decrypting — or never, because the store was empty.
   */
  async ready(): Promise<void> {
    await this.key;
  }
  private async createKey(secret: string): Promise<CryptoKey> {
    // Browsers only offer this on a secure origin. Opening the same page over http on a LAN address instead
    // of localhost is the usual way to end up without it, and saying so beats a TypeError about `undefined`.
    if (!globalThis.crypto?.subtle) {
      throw new RelayKitError(
        "NOT_CONFIGURED",
        "Encrypted storage needs a secure origin: serve the page over https, or reach it on localhost"
      );
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  private async createKeyFromPassphrase(passphrase: string, salt: string): Promise<CryptoKey> {
    if (!globalThis.crypto?.subtle) {
      throw new RelayKitError(
        "NOT_CONFIGURED",
        "Encrypted storage needs a secure origin: serve the page over https, or reach it on localhost"
      );
    }
    const typed = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: new TextEncoder().encode(salt),
        iterations: howHardToGuess,
        hash: "SHA-256"
      },
      typed,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }
  async encrypt(value: string): Promise<string> {
    if (!this.key) {
      return value;
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await this.key,
      new TextEncoder().encode(value)
    );
    return `${sealedBy}${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
  }
  /** Encrypts raw bytes as `iv (12 bytes) + ciphertext`; file contents queued in the outbox go through here. */
  async encryptBytes(value: Uint8Array): Promise<Uint8Array> {
    if (!this.key) {
      return value;
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await this.key, ownBuffer(value))
    );
    const stored = new Uint8Array(iv.byteLength + encrypted.byteLength);
    stored.set(iv);
    stored.set(encrypted, iv.byteLength);
    return stored;
  }
  /** Returns undefined when the stored bytes were written with a different key. */
  async decryptBytes(value: Uint8Array): Promise<Uint8Array | undefined> {
    if (!this.key) {
      return value;
    }
    const iv = value.slice(0, 12);
    const encrypted = ownBuffer(value.subarray(12));
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await this.key, encrypted));
    } catch {
      return undefined;
    }
  }
  /**
   * Opens what this locked away, and hands back anything it did not.
   *
   * Told apart by a mark this library puts there, not by guessing at the shape. Guessing meant anything
   * somebody said with a full stop in it — "Hola. Que tal?" — looked like ciphertext to a store that had a
   * key, and was thrown away as unreadable. Nothing a person can type begins with this mark.
   *
   * Returns undefined only when this really was sealed and this key will not open it.
   */
  async decrypt(value: string): Promise<string | undefined> {
    if (!this.key || !value.startsWith(sealedBy)) {
      return value;
    }
    const [ivValue, encryptedValue] = value.slice(sealedBy.length).split(".");
    if (!ivValue || !encryptedValue) {
      return value;
    }
    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: decode(ivValue) },
        await this.key,
        decode(encryptedValue)
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      return undefined;
    }
  }
}

function encode(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  const encoded = atob(value);
  const buffer = new ArrayBuffer(encoded.length);
  const result = new Uint8Array(buffer);
  for (let index = 0; index < encoded.length; index += 1) {
    result[index] = encoded.charCodeAt(index);
  }
  return result;
}

function ownBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}
