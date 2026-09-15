import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { LockedAway } from "../packages/browser-storage/dist/locked-away.js";

const passphrase = "la frase que escribe una persona";

async function lockedWithAPassphrase(salt) {
  const locked = new LockedAway();
  locked.lockWithPassphrase(passphrase, salt);
  await locked.ready();
  return locked;
}

test("the same passphrase in two places does not give the same key", async () => {
  // What a salt buys, and the reason it matters: two devices, or two accounts on one, with the same
  // passphrase must not produce the same bytes. Otherwise anything precomputed once works everywhere, and
  // one copy being broken breaks the other.
  const here = await lockedWithAPassphrase("sal-de-aqui");
  const there = await lockedWithAPassphrase("sal-de-alla");

  const sealed = await here.encrypt("un secreto");

  assert.equal(await there.decrypt(sealed), undefined, "the other one could read it");
  assert.equal(await here.decrypt(sealed), "un secreto");
});

test("the same passphrase and the same salt is the same key, or nothing would ever reopen", async () => {
  const today = await lockedWithAPassphrase("la misma sal");
  const sealed = await today.encrypt("un secreto");

  const tomorrow = await lockedWithAPassphrase("la misma sal");

  assert.equal(await tomorrow.decrypt(sealed), "un secreto");
});

test("a passphrase is not derived the fast way a random secret is", async () => {
  // Not a timing test, which would be flaky. What is asserted is that the two are told apart at all: a
  // passphrase somebody typed has little entropy, and a single fast digest of it is guessable offline.
  const typed = await lockedWithAPassphrase("la misma sal");
  const random = new LockedAway();
  random.lockWith(passphrase);
  await random.ready();

  const sealed = await typed.encrypt("un secreto");

  assert.equal(
    await random.decrypt(sealed),
    undefined,
    "a typed passphrase and a random secret went through the same derivation"
  );
});

test("how it was derived is written down, so it can be changed later without locking anybody out", () => {
  const locked = new LockedAway();
  locked.lockWithPassphrase(passphrase, "sal");

  const how = locked.howItWasDerived();

  assert.equal(how.kdf, "pbkdf2-sha256");
  assert.ok(how.iterations >= 600_000, "a work factor below what is recommended today");
  assert.equal(how.version, 1);
});
