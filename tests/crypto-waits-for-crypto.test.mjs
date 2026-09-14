import assert from "node:assert/strict";
import test from "node:test";
import { MatrixCrypto } from "../packages/matrix-js/dist/matrix-crypto.js";

/** A runtime whose crypto stack is not up yet, the way starting without waiting for the sync leaves it. */
function runtimeStillComingUp() {
  let itIsUp = () => {};
  const up = new Promise(resolve => {
    itIsUp = resolve;
  });
  let crypto;
  const runtime = {
    whenCryptoIsUp: () => up,
    getClient: () => ({ getCrypto: () => crypto }),
    secretStorageKeys: {}
  };
  return {
    runtime,
    finish() {
      crypto = {
        isCrossSigningReady: async () => true,
        isSecretStorageReady: async () => true
      };
      itIsUp();
    }
  };
}

test("asking about the keys before the crypto stack is up waits for it instead of refusing", async () => {
  const { runtime, finish } = runtimeStillComingUp();
  const crypto = new MatrixCrypto(runtime);
  let answered = false;

  const asking = crypto.getCryptoStatus().then(status => {
    answered = true;
    return status;
  });
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(answered, false, "it must not have answered before the crypto stack came up");
  finish();

  assert.deepEqual(await asking, { crossSigningReady: true, secretStorageReady: true });
});
