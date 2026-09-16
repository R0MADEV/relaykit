import assert from "node:assert/strict";
import test from "node:test";
import { whatOpensThese } from "../examples/web/src/app/what-opens-these-keys.ts";

/**
 * A device that cannot read what was said before it has two ways out, and which of them exist depends on the
 * account, not on the screen. Offering both regardless is what led somebody to press "Introducir clave" three
 * times asking which key, with no other session in the world to have one.
 */
test("with another session, either way out is offered, and the other one is named", () => {
  const out = whatOpensThese("locked", { otherSessions: 2 });

  assert.equal(out.canAskAnotherSession, true);
  assert.match(out.under, /otra sesión/);
});

test("alone, there is only the key, and the banner says where it came from", () => {
  const out = whatOpensThese("locked", { otherSessions: 0 });

  // Not a button that cannot work: there is nobody to ask.
  assert.equal(out.canAskAnotherSession, false);
  // And the one thing a person needs to know, which nothing said: which key this is.
  assert.match(out.under, /guardaste/);
  assert.match(out.under, /única|sola/);
});

test("with nothing ever protected, it offers to protect rather than to open", () => {
  const out = whatOpensThese("never-protected", { otherSessions: 3 });

  assert.equal(out.canAskAnotherSession, false);
  assert.equal(out.act, "Proteger mis mensajes");
});
