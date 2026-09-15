"use strict";
// Filing a conversation away and changing a password, in a real browser.
//
// The contract tests prove the homeserver answers; they cannot prove that somebody presses a menu item, types
// a name, sees a pill appear above the conversation, and presses it again to take it back out. That round
// trip is the feature here, and the only way to check it is to take it.
//
// It signs in as an account made for this run and thrown away at the end, because changing a password is the
// one thing here that cannot be undone by the next test if it goes wrong halfway.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { serve, acceptOwnCertificate, waitFor } = require("./browser-harness.cjs");

const root = path.join(__dirname, "..", "examples", "web", "dist");
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const who = `check-account-${Date.now()}`;
const first = "first-password";
const second = "second-password";
const detail = { who };

function report(ok, summary) {
  console.log(`RELAYKIT_ACCOUNT_RESULT ${JSON.stringify({ ok, summary, detail })}`);
  app.exit(ok ? 0 : 1);
}

const run = (page, script) => page.webContents.executeJavaScript(`${script}\n;true;`);
const read = (page, script) => page.webContents.executeJavaScript(script);

/** An account of its own, so nothing this does can lock anybody else out of the development homeserver. */
async function makeAnAccount() {
  const start = await fetch(`${homeserver}/_matrix/client/v3/register`, {
    method: "POST",
    body: JSON.stringify({ username: who, password: first })
  });
  const asked = await start.json();
  const done = await fetch(`${homeserver}/_matrix/client/v3/register`, {
    method: "POST",
    body: JSON.stringify({
      username: who,
      password: first,
      auth: { type: "m.login.dummy", session: asked.session }
    })
  });
  if (!done.ok) throw new Error(`the homeserver would not make the account: ${await done.text()}`);
}

async function signIn(page) {
  await waitFor(page, "the sign in form", `!document.getElementById("sign-in").hidden`, 30);
  await run(
    page,
    `
    document.getElementById("homeserver").value = ${JSON.stringify(homeserver)};
    document.getElementById("username").value = ${JSON.stringify(who)};
    document.getElementById("password").value = ${JSON.stringify(first)};
    document.getElementById("sign-in").requestSubmit();
  `
  );
  await waitFor(page, "to be signed in", `!document.getElementById("shell").hidden`, 90);
}

/** A conversation of its own to file away, because an account this new is in none. */
/**
 * Signing out, and what the token can do afterwards.
 *
 * On a session nothing else has touched, because that is the question: closing the window is not signing
 * out, and a token still good on the homeserver is somebody else's session left open on a shared computer
 * with nothing on screen to say so.
 */
async function signingOutReallyEndsIt(page) {
  const before = await read(page, `JSON.parse(localStorage.getItem("deitu-session")).accessToken`);
  await run(page, `document.getElementById("me").click(); document.getElementById("sign-out").click();`);
  await waitFor(page, "the sign in form after signing out", `!document.getElementById("sign-in").hidden`, 60);
  const stillGood = await fetch(`${homeserver}/_matrix/client/v3/account/whoami`, {
    headers: { Authorization: `Bearer ${before}` }
  });
  if (stillGood.ok) throw new Error("signing out left the token working on the homeserver");
  detail.signingOutEndedIt = true;
}

async function makeAConversation(page) {
  await run(
    page,
    `
    document.querySelector("[data-opens=create-channel]").click();
    document.getElementById("channel-name").value = "archivo";
    document.getElementById("create-channel").querySelector("[value=create]").click();
  `
  );
  await waitFor(page, "the conversation to open", `document.getElementById("open-title").textContent`, 60);
}

/**
 * A search result that opens where it was said.
 *
 * The point of the whole thing: a line on its own says who said it and almost never what it was about, so
 * what is checked is that the messages around it are on screen afterwards — not only that something opened.
 */
async function openAResultWhereItWasSaid(page) {
  for (const what of ["antes de todo", "la aguja", "después de todo"]) {
    await run(
      page,
      `document.getElementById("write").value = ${JSON.stringify(what)};
      document.getElementById("composer").requestSubmit();`
    );
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  await waitFor(page, "the three messages", `document.querySelectorAll("[data-message]").length >= 3`, 60);

  await run(
    page,
    `
    document.getElementById("search").value = "aguja";
    document.getElementById("search").dispatchEvent(new Event("input"));
  `
  );
  await waitFor(page, "the result", `document.querySelector("[data-found-said]")`, 60);
  await run(page, `document.querySelector("[data-found-said]").click();`);

  await waitFor(page, "it to land on the message", `document.querySelector("[data-found]")`, 60);
  detail.landedOn = await read(
    page,
    `document.querySelector("[data-found]").textContent.replace(/\\s+/g, " ").trim()`
  );
  if (!detail.landedOn.includes("la aguja")) {
    throw new Error(`it opened on ${detail.landedOn}, which is not what was searched for`);
  }
  // And what was said around it is there, which is the whole reason for opening here.
  detail.around = await read(page, `document.querySelectorAll("[data-message]").length`);
  if (detail.around < 3) throw new Error("it opened on the message with nothing around it");
}

/** Asking the conversation something, voting on it, and closing it — which is the whole of a poll. */
async function askTheConversationSomething(page) {
  await run(
    page,
    `
    document.getElementById("more-button").click();
    document.getElementById("ask-something").click();
    document.getElementById("ask-question").value = "¿Dónde comemos?";
    document.getElementById("ask-answers").value = "En el bar, en la oficina";
    document.getElementById("ask-form").requestSubmit();
  `
  );
  await waitFor(page, "the question to be up", `document.querySelector("[data-votes]")`, 60);
  detail.asked = await read(page, `document.querySelector(".poll-question strong").textContent`);

  await run(page, `document.querySelector("[data-votes]").click();`);
  await waitFor(
    page,
    "the vote to be counted",
    `document.querySelector("[data-votes]").textContent.includes("1")`,
    60
  );
  detail.voted = await read(page, `document.querySelector("[data-votes]").textContent.trim()`);

  await run(page, `document.querySelector("[data-closes]").click();`);
  await waitFor(page, "the question to be closed", `!document.querySelector("[data-closes]")`, 60);
}

async function fileItAway(page) {
  await run(
    page,
    `
    window.prompt = () => "trabajo";
    document.getElementById("more-button").click();
    document.getElementById("tag-here").click();
  `
  );
  await waitFor(
    page,
    "the tag to show above the conversation",
    `document.querySelector("[data-untags]")`,
    30
  );
  detail.filedUnder = await read(page, `document.querySelector("[data-untags]").textContent`);
  if (detail.filedUnder !== "trabajo") {
    throw new Error(`the tag showed as ${detail.filedUnder}, which is not what was typed`);
  }

  // And back out, by pressing the pill that was drawn.
  await run(page, `document.querySelector("[data-untags]").click();`);
  await waitFor(page, "the tag to go", `!document.querySelector("[data-untags]")`, 30);
}

async function changeThePassword(page, otherSession) {
  await run(
    page,
    `
    document.getElementById("me").click();
    document.getElementById("my-password-now").value = ${JSON.stringify(first)};
    document.getElementById("my-password-new").value = ${JSON.stringify(second)};
    document.getElementById("my-password-save").click();
  `
  );
  await waitFor(page, "the homeserver to answer", `!document.getElementById("account-said").hidden`, 30);
  detail.said = await read(page, `document.getElementById("account-said").textContent`);

  // The other sessions really are closed, which is the homeserver's doing and what the screen just claimed.
  const elsewhere = await fetch(`${homeserver}/_matrix/client/v3/account/whoami`, {
    headers: { Authorization: `Bearer ${otherSession}` }
  });
  if (elsewhere.ok) throw new Error("the screen said the other sessions were closed and one still works");

  // What proves it changed is the old one no longer working and the new one doing.
  const withOld = await fetch(`${homeserver}/_matrix/client/v3/login`, {
    method: "POST",
    body: JSON.stringify({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: who },
      password: first
    })
  });
  if (withOld.ok) throw new Error("the old password still works, so nothing was changed");
  const withNew = await fetch(`${homeserver}/_matrix/client/v3/login`, {
    method: "POST",
    body: JSON.stringify({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: who },
      password: second
    })
  });
  if (!withNew.ok) throw new Error("the new password does not work either");
  return (await withNew.json()).access_token;
}

/**
 * The end of the account, which is also how this run cleans up after itself.
 *
 * From a session signed in with the new password, not the one that changed it. Nobody changes a password and
 * deletes the account in the same breath, and Synapse answers that exact sequence with a 404 about a row of
 * its own — a homeserver bug, and not one worth building the check around.
 */
async function closeTheAccount(page) {
  await run(page, `document.getElementById("sign-out").click();`);
  await waitFor(page, "the sign in form again", `!document.getElementById("sign-in").hidden`, 60);
  await run(
    page,
    `
    document.getElementById("homeserver").value = ${JSON.stringify(homeserver)};
    document.getElementById("username").value = ${JSON.stringify(who)};
    document.getElementById("password").value = ${JSON.stringify(second)};
    document.getElementById("sign-in").requestSubmit();
  `
  );
  await waitFor(
    page,
    "to be signed in with the new password",
    `!document.getElementById("shell").hidden`,
    90
  );

  await run(
    page,
    `
    window.confirm = () => true;
    window.prompt = () => ${JSON.stringify(second)};
    document.getElementById("me").click();
    document.getElementById("close-account").click();
  `
  );
  await waitFor(page, "to be signed out", `!document.getElementById("sign-in").hidden`, 60).catch(
    async error => {
      detail.whileClosing = await read(page, `document.getElementById("account-wrong").textContent`);
      throw error;
    }
  );
}

/**
 * And in again without an account at all, from the same form the account was just closed from.
 *
 * A guest is not a small account: the homeserver refuses it its keys and its notification rules, so getting
 * as far as the shell is the whole of what this proves.
 */
async function comeInWithoutAnAccount(page) {
  await run(
    page,
    `
    document.getElementById("homeserver").value = ${JSON.stringify(homeserver)};
    document.getElementById("as-guest").click();
  `
  );
  await waitFor(page, "a guest to get in", `!document.getElementById("shell").hidden`, 90);
  detail.guest = await read(page, `document.getElementById("account-who")?.textContent ?? ""`);
  if (!detail.guest) throw new Error("a guest got in but the application does not say who it is");
}

async function main() {
  const server = await serve(root);
  const page = new BrowserWindow({
    show: false,
    width: 1100,
    height: 860,
    webPreferences: { partition: `persist:account-${Date.now()}` }
  });
  acceptOwnCertificate(page.webContents.session);
  page.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) console.error(`[page] ${message}`);
  });

  await makeAnAccount();
  await page.loadURL(`https://127.0.0.1:${server.address().port}/app.html`);
  await signIn(page);
  await signingOutReallyEndsIt(page);
  await signIn(page);
  await makeAConversation(page);
  await fileItAway(page);
  await askTheConversationSomething(page);
  await openAResultWhereItWasSaid(page);
  // A second session, open elsewhere, so the claim that they get closed is checked rather than believed.
  const elsewhere = await fetch(`${homeserver}/_matrix/client/v3/login`, {
    method: "POST",
    body: JSON.stringify({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: who },
      password: first
    })
  });
  await changeThePassword(page, (await elsewhere.json()).access_token);
  await closeTheAccount(page);
  await comeInWithoutAnAccount(page);

  server.close();
  report(
    true,
    `asked «${detail.asked}» and counted a vote, filed under ${detail.filedUnder}, opened a result on «${detail.landedOn}» with ` +
      `${detail.around} messages around it, changed the password, closed the account, ` +
      `and came back in as ${detail.guest}`
  );
}

app
  .whenReady()
  .then(main)
  .catch(error => report(false, error.message));
