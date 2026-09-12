import assert from "node:assert/strict";
import test from "node:test";

const { secretForThisDevice } = await import("../packages/web/dist/index.js");

/**
 * The secret that encrypts the local copy must not change when somebody signs in again, or yesterday's copy
 * is unreadable and gets dropped without a word. It belongs to the device, not to the session.
 */
function withLocalStorage(work) {
  const kept = new Map();
  globalThis.localStorage = {
    getItem: key => kept.get(key) ?? null,
    setItem: (key, value) => kept.set(key, String(value)),
    removeItem: key => kept.delete(key)
  };
  return work(kept).finally(() => { delete globalThis.localStorage; });
}

test("the same device gets the same secret every time", async () => {
  await withLocalStorage(async () => {
    const first = secretForThisDevice();
    const second = secretForThisDevice();

    assert.equal(first, second);
    assert.ok(first.length >= 32, `too short to be worth anything: ${first.length}`);
  });
});

test("a device that never had one gets one made, and keeps it", async () => {
  await withLocalStorage(async kept => {
    assert.equal(kept.size, 0);

    const secret = secretForThisDevice();

    assert.equal([...kept.values()][0], secret);
  });
});

test("two devices do not end up with the same secret", async () => {
  const one = await withLocalStorage(async () => secretForThisDevice());
  const other = await withLocalStorage(async () => secretForThisDevice());

  assert.notEqual(one, other);
});
