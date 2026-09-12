import type { BaseKeyProvider } from "livekit-client";

/**
 * The keys a conference is encrypted with, handed from Matrix to the SFU's engine.
 *
 * Matrix makes the keys and passes them between the people on the call, the way it passes everything else
 * that must stay between them. The engine encrypts every frame with them before anything leaves the
 * browser and decrypts on the way in, so what the SFU carries it cannot read. Neither side knows the other
 * exists: this is the piece that hands the key from one to the other, and it is all it does.
 */
export interface ConferenceKeys extends BaseKeyProvider {
  /** A key Matrix has for somebody on the call. Theirs when it is theirs; this side's own when it is. */
  receive(key: Uint8Array, participantIdentity: string, keyIndex: number): Promise<void>;
}

/** The two things the engine has to lend for this: its provider to build on, and its way of importing a key. */
export interface KeyEngine {
  readonly BaseKeyProvider: typeof BaseKeyProvider;
  readonly createKeyMaterialFromBuffer: (buffer: ArrayBuffer) => Promise<CryptoKey>;
}

/**
 * Built from the engine once it is loaded and not before, because extending its provider means having it,
 * and having it is what an application that never opens a conference should be spared.
 */
export function keysFor(engine: KeyEngine): ConferenceKeys {
  class MatrixKeys extends engine.BaseKeyProvider implements ConferenceKeys {
    constructor() {
      super({
        // One key per person and not one for the room: Matrix rotates them when somebody leaves, so whoever
        // left cannot follow what is said after them.
        sharedKey: false,
        // Rotation is Matrix's, so the engine is not to ratchet on its own.
        ratchetWindowSize: 0,
        // A frame that cannot be decrypted is a frame missed, not a reason to give up on the sender.
        failureTolerance: -1,
        // Matrix numbers keys upwards for as long as a call lasts, and the engine keeps as many as this.
        keyringSize: 256
      });
    }

    async receive(key: Uint8Array, participantIdentity: string, keyIndex: number): Promise<void> {
      // A copy, so what is imported starts at zero whatever view of a larger buffer Matrix handed over.
      const material = await engine.createKeyMaterialFromBuffer(key.slice().buffer);
      this.onSetEncryptionKey(material, participantIdentity, keyIndex);
    }
  }
  return new MatrixKeys();
}
