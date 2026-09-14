"use strict";
// A brand new account, from the screen, all the way to being able to read what is said to it.
//
// This is the path nothing else covers: the unit tests prove what the library answers, and the contract tests
// prove what the homeserver does, but neither can say whether somebody who has just signed in is told that
// their messages are unprotected and can do something about it in two clicks.
//
// A fresh account every run on purpose. Setting recovery up replaces the cross-signing identity, so running
// this against a shared account leaves it unable to verify anything afterwards.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { serve, acceptOwnCertificate, waitFor } = require("./browser-harness.cjs");

const root = path.join(__dirname, "..", "examples", "web", "dist");
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";

function report(ok, summary) {
  console.log(`RELAYKIT_KEYS_RESULT ${JSON.stringify({ ok, summary })}`);
  app.exit(ok ? 0 : 1);
}

async function run() {
  const { registerAccount } = await import("./fresh-accounts.mjs");
  const account = await registerAccount("keys", "RelayKit keys check", { start: false });
  console.log(`registered ${account.userId}`);

  const server = await serve(root);
  const page = await open(server, `keys-${account.username}`);
  await signIn(page, account);

  // An account that has never protected anything has to be told so, and offered the one thing that helps.
  await waitFor(page, "the keys banner", `!document.getElementById("keys").hidden`, 60);
  const said = await page.webContents.executeJavaScript(`document.getElementById("keys-title").textContent`);
  if (!said.includes("no están protegidos")) {
    return report(false, `a fresh account was told: ${said}`);
  }
  // Nothing to be let into, so the way in from another session must not be offered.
  const offersAnotherSession = await page.webContents.executeJavaScript(
    `!document.getElementById("keys-verify").hidden`
  );
  if (offersAnotherSession) {
    return report(false, "an account with nothing to restore was offered another session to restore from");
  }

  await page.webContents.executeJavaScript(`document.getElementById("keys-act").click(); true;`);
  await waitFor(page, "the recovery dialog", `document.getElementById("recovery").open`, 20);
  await page.webContents.executeJavaScript(`document.getElementById("recovery-go").click(); true;`);
  await waitFor(page, "a recovery key", `document.getElementById("recovery-key").value.length > 10`, 60);
  const key = await page.webContents.executeJavaScript(`document.getElementById("recovery-key").value`);

  // It is shown once and never again, so the way out is saying it was kept.
  const stuck = await page.webContents.executeJavaScript(
    `document.getElementById("recovery-go").hasAttribute("disabled")`
  );
  if (!stuck) return report(false, "the dialog let go of the key before anybody said they had kept it");

  await page.webContents.executeJavaScript(`
    document.getElementById("recovery-kept").checked = true;
    document.getElementById("recovery-kept").dispatchEvent(new Event("change"));
    document.getElementById("recovery-go").click();
    true;
  `);
  await waitFor(page, "the keys to be in order", `document.getElementById("keys").hidden`, 60);

  // The other half: the same account on a device that was not there. It must say something different, and
  // the key that was just made must open it.
  const second = await open(server, `keys-again-${account.username}`);
  await signIn(second, account);
  await waitFor(
    second,
    "the keys banner on the second device",
    `!document.getElementById("keys").hidden`,
    60
  );
  const toldTheSecond = await second.webContents.executeJavaScript(
    `document.getElementById("keys-title").textContent`
  );
  if (!toldTheSecond.includes("no puede leer")) {
    return report(false, `a device that was not there was told: ${toldTheSecond}`);
  }

  await second.webContents.executeJavaScript(`document.getElementById("keys-act").click(); true;`);
  await waitFor(second, "the recovery dialog", `document.getElementById("recovery").open`, 20);
  await second.webContents.executeJavaScript(`
    document.getElementById("recovery-given").value = ${JSON.stringify(key)};
    document.getElementById("recovery-go").click();
    true;
  `);
  await waitFor(second, "the second device to be let in", `document.getElementById("keys").hidden`, 90);

  // And the other way in, for somebody who did not keep the key: a device this account already trusts.
  const third = await open(server, `keys-vouched-${account.username}`);
  await signIn(third, account);
  await waitFor(third, "the keys banner on the third device", `!document.getElementById("keys").hidden`, 60);
  await third.webContents.executeJavaScript(`document.getElementById("keys-verify").click(); true;`);

  // It rings on the device that is already trusted, without anybody there pressing anything first.
  await waitFor(page, "the first device to be asked", `document.getElementById("verifying").open`, 60);
  await press(page, "verifying-yes");
  await bothCompare(page, third);
  await press(page, "verifying-yes");
  await press(third, "verifying-yes");
  await waitFor(third, "the third device to be vouched for", whatItSays("verifying-under", "verificada"), 60);

  server.close();
  report(
    true,
    "a new account protected its messages, a second device opened them with the key, and a third was vouched for"
  );
}

/** Both screens have to be showing the same emoji before either can say they match. */
async function bothCompare(one, other) {
  for (const page of [one, other]) {
    await waitFor(
      page,
      "the emoji to compare",
      `document.querySelectorAll("#verifying-emoji li").length > 0`,
      60
    );
  }
  const [said, alsoSaid] = await Promise.all([one, other].map(readTheEmoji));
  if (said !== alsoSaid) {
    throw new Error(`the two screens showed different emoji: ${said} against ${alsoSaid}`);
  }
}

function readTheEmoji(page) {
  return page.webContents.executeJavaScript(
    `[...document.querySelectorAll("#verifying-emoji li .symbol")].map(one => one.textContent).join("")`
  );
}

function whatItSays(id, word) {
  return `document.getElementById(${JSON.stringify(id)}).textContent.includes(${JSON.stringify(word)})`;
}

function press(page, id) {
  return page.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).click(); true;`);
}

/** A window of its own for each device: two devices sharing a store are one device wearing two names. */
async function open(server, partition) {
  const page = new BrowserWindow({
    show: false,
    width: 1280,
    height: 860,
    webPreferences: { partition: `persist:${partition}` }
  });
  acceptOwnCertificate(page.webContents.session);
  page.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) console.error(`[${partition}] ${message}`);
  });
  await page.loadURL(`https://127.0.0.1:${server.address().port}/app.html`);
  return page;
}

async function signIn(page, account) {
  await waitFor(page, "the sign in form", `!document.getElementById("sign-in").hidden`, 30);
  await page.webContents.executeJavaScript(`
    document.getElementById("homeserver").value = ${JSON.stringify(homeserver)};
    document.getElementById("username").value = ${JSON.stringify(account.username)};
    document.getElementById("password").value = ${JSON.stringify(account.password)};
    document.getElementById("sign-in").requestSubmit();
    true;
  `);
  await waitFor(page, "the shell", `!document.getElementById("shell").hidden`, 60);
}

app
  .whenReady()
  .then(run)
  .catch(error => report(false, error.message));
