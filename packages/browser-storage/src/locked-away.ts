import { SdkError } from "@relaykit/core";

/**
 * Turning what is kept locally into bytes nobody else on this machine can read, and back.
 *
 * Apart from the store because it is a different subject: one is where records live and how they are found,
 * the other is that a record written with one key cannot be read with another — which is what makes a local
 * copy safe to leave behind and is the only part of this with a wrong answer.
 */
export class LockedAway {
  private key: Promise<CryptoKey> | undefined;

  /** Without a secret nothing is locked: the records go in as they are, which is what an open store is. */
  lockWith(secret: string | undefined): void {
    this.key = secret === undefined ? undefined : this.createKey(secret);
    // Held onto until somebody asks for a record, so a failure is reported then and not as a rejection
    // nobody was listening for.
    this.key?.catch(() => undefined);
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
      throw new SdkError(
        "NOT_CONFIGURED",
        "Encrypted storage needs a secure origin: serve the page over https, or reach it on localhost"
      );
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
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
    return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
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
  /** Returns undefined when the stored value was written with a different key. */
  async decrypt(value: string): Promise<string | undefined> {
    if (!this.key || !value.includes(".")) {
      return value;
    }
    const [ivValue, encryptedValue] = value.split(".");
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
