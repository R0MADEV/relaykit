import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { IndexedDbStorage } from "@relaykit/browser-storage";

/**
 * `crypto.subtle` only exists on a secure origin. Opening the same page over http on a LAN address instead of
 * localhost is the usual way to end up without it, and then storing anything encrypted is impossible. What
 * must not happen is a TypeError about reading a property of undefined, which says nothing about the cause.
 */
function withoutSubtleCrypto(work) {
  const real = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    value: { getRandomValues: real.getRandomValues.bind(real) },
    configurable: true
  });
  return work().finally(() => {
    Object.defineProperty(globalThis, "crypto", { value: real, configurable: true });
  });
}

test("asking for encrypted storage where it cannot exist says why", async () => {
  await withoutSubtleCrypto(async () => {
    const failure = await new IndexedDbStorage("prueba-insegura", { encryptionSecret: "un secreto" })
      .getConversations()
      .catch(error => error);

    assert.ok(failure instanceof Error, "it did not fail at all");
    assert.doesNotMatch(failure.message, /of undefined|undefined \(reading/, `unhelpful message: ${failure.message}`);
    assert.match(failure.message, /segur|secure/i);
  });
});

test("without encryption asked for, an insecure origin still works", async () => {
  await withoutSubtleCrypto(async () => {
    const storage = new IndexedDbStorage("prueba-sin-cifrar");

    assert.deepEqual(await storage.getConversations(), []);
  });
});
