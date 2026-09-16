"use strict";
// Signing in with somebody else's identity provider, in a real browser.
//
// The unit tests prove the shape and the contract tests prove the homeserver answers; neither can prove that
// a person presses a button, ends up somewhere that is not this application, types a password there, comes
// back, and is signed in. That whole trip is the feature, and the only way to check it is to take it.
//
// The provider is the Dex next door (infrastructure/matrix), and it is a real one: it issues a real identity
// token that Synapse really verifies.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { serve, acceptOwnCertificate, waitFor } = require("./browser-harness.cjs");

const root = path.join(__dirname, "..", "examples", "web", "dist");
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
// Dex's own static user. The password is `password`, from its documentation.
const who = process.env.RELAYKIT_SSO_USER ?? "dana@deitu.example";
const secret = process.env.RELAYKIT_SSO_PASSWORD ?? "password";
const detail = {};

function report(ok, summary) {
  console.log(`RELAYKIT_SSO_RESULT ${JSON.stringify({ ok, summary, detail })}`);
  app.exit(ok ? 0 : 1);
}

const run = (page, script) => page.webContents.executeJavaScript(`${script}\n;true;`);
const read = (page, script) => page.webContents.executeJavaScript(script);
const where = page => page.webContents.getURL();

async function main() {
  const server = await serve(root);
  const page = new BrowserWindow({
    show: false,
    width: 1100,
    height: 860,
    webPreferences: { partition: `persist:sso-${Date.now()}` }
  });
  acceptOwnCertificate(page.webContents.session);
  page.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) console.error(`[page] ${message}`);
  });
  await page.loadURL(`https://127.0.0.1:${server.address().port}/`);

  await waitFor(page, "the sign in form", `!document.getElementById("sign-in").hidden`, 30);
  await run(
    page,
    `
    document.getElementById("homeserver").value = ${JSON.stringify(homeserver)};
    document.getElementById("homeserver").dispatchEvent(new Event("change"));
  `
  );

  // A button per way in, drawn from what the homeserver said it takes — not from anything written here.
  await waitFor(
    page,
    "a way in besides a password",
    `document.querySelectorAll("[data-way-in]").length > 0`,
    30
  );
  detail.offered = await read(
    page,
    `[...document.querySelectorAll("[data-way-in]")].map(each => each.textContent.trim())`
  );

  await run(page, `document.querySelector("[data-way-in]").click();`);

  // Somewhere that is not this application.
  await new Promise(resolve => setTimeout(resolve, 4000));
  console.log("landed on:", where(page));
  console.log("wrong:", await read(page, `document.getElementById("sign-in-wrong")?.textContent ?? ""`));
  await waitFor(page, "the identity provider", `location.host.includes("5556")`, 30);
  detail.leftTo = where(page);
  await signInThere(page);

  await sayYesToTheHomeserver(page);
  // And back, with the one-time token in the address, spent without anybody pressing anything else.
  await waitFor(page, "the application again", `location.pathname === "/"`, 60);
  await waitFor(page, "to be signed in", `!document.getElementById("shell").hidden`, 90);
  detail.signedInAs = await read(page, `document.getElementById("account-who")?.textContent ?? ""`);

  const stillInTheAddress = await read(page, `location.search.includes("loginToken")`);
  if (stillInTheAddress) {
    return report(false, "the one-time token was left in the address, where it can be shared by accident");
  }

  // And it lasts: opening it again does not ask anything.
  await page.loadURL(`https://127.0.0.1:${server.address().port}/`);
  await waitFor(page, "to still be signed in", `!document.getElementById("shell").hidden`, 90);

  server.close();
  report(true, `signed in through ${detail.offered.join(", ")} and stayed signed in`);
}

/**
 * The homeserver's own "continue to your account" page.
 *
 * Shown because the address coming back is not one it was told to trust, which is exactly what it should do
 * with an unknown one. A person clicks it, so this clicks it: whitelisting the address in the development
 * configuration would skip a screen that really is there.
 */
async function sayYesToTheHomeserver(page) {
  await waitFor(
    page,
    "the homeserver to ask",
    `location.pathname.includes("/_synapse/client/") || location.pathname === "/"`,
    60
  );
  if (where(page) === "/") return;
  await waitFor(
    page,
    "the continue button",
    `document.querySelector("a.primary-button, button, a[href]") !== null`,
    30
  );
  detail.asked = await read(
    page,
    `document.body.textContent.replace(/[ \\n\\t]+/g, " ").trim().slice(0, 80)`
  );
  await run(
    page,
    `
    const yes = [...document.querySelectorAll("a, button")]
      .find(each => /continu|aceptar|allow/i.test(each.textContent));
    if (yes) yes.click();
  `
  );
}

/** Dex's own form: an email, a password, and a button. Nothing of this application is on this page. */
async function signInThere(page) {
  await waitFor(page, "the provider's form", `document.querySelector("input[type=password]") !== null`, 30);
  await run(
    page,
    `
    const form = document.querySelector("input[type=password]").form;
    form.querySelector("input[type=text], input[type=email], input[name=login]").value = ${JSON.stringify(who)};
    form.querySelector("input[type=password]").value = ${JSON.stringify(secret)};
    form.submit();
  `
  );
}

app
  .whenReady()
  .then(main)
  .catch(error => report(false, error.message));
