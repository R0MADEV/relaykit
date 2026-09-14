"use strict";
// Two people using the application, in two real browsers.
//
// The unit tests prove what the library answers and the contract tests prove what the homeserver does.
// Neither can say whether somebody can attach a picture and have the other side see it, open a thread, find
// something that was said, take a moderator's rank away, or come back to a half-written message. That is the
// interface, and the interface is only exercised by driving it.
//
// Fresh accounts every run: a channel somebody clicked around in last time is not a starting point, and
// moderation in particular leaves ranks behind.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { serve, acceptOwnCertificate, waitFor } = require("./browser-harness.cjs");

const root = path.join(__dirname, "..", "examples", "web", "dist");
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const detail = {};

function report(ok, summary) {
  console.log(`RELAYKIT_CHAT_RESULT ${JSON.stringify({ ok, summary, detail })}`);
  app.exit(ok ? 0 : 1);
}

/** A window of its own for each person: two people sharing a store are one person wearing two names. */
async function open(server, who) {
  const page = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { partition: `persist:chat-${who}` }
  });
  acceptOwnCertificate(page.webContents.session);
  page.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) console.error(`[${who}] ${message}`);
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

const run = (page, script) => page.webContents.executeJavaScript(`${script}\n;true;`);
const read = (page, script) => page.webContents.executeJavaScript(script);

/** Opens the channel by the name on its row, which is the only way in that a person has. */
async function openChannel(page, name, who) {
  const row = `[...document.querySelectorAll("#channels li button")].find(each => each.textContent.includes(${JSON.stringify(name)}))`;
  await waitFor(page, `${who} to see #${name}`, `Boolean(${row})`, 90);
  await run(page, `${row}.click();`);
  await waitFor(
    page,
    `#${name} to open for ${who}`,
    `document.getElementById("open-title").textContent.includes(${JSON.stringify(name)})`,
    30
  );
}

/** Everything on screen in the conversation, as one string to look through. */
const said = `[...document.querySelectorAll("#timeline .said p")].map(each => each.textContent).join(" | ")`;

async function main() {
  const { registerAccount } = await import("./fresh-accounts.mjs");
  const [alice, bob] = await Promise.all([
    registerAccount("chat-a", "RelayKit chat check", { start: false }),
    registerAccount("chat-b", "RelayKit chat check", { start: false })
  ]);
  console.log(`registered ${alice.userId} and ${bob.userId}`);

  const server = await serve(root);
  const [one, other] = await Promise.all([open(server, alice.username), open(server, bob.username)]);
  await Promise.all([signIn(one, alice), signIn(other, bob)]);

  const channel = `prueba-${Date.now()}`;
  await makeTheChannel(one, channel);
  await openChannel(one, channel, "alice");
  await theOtherWalksIn(other, channel);

  await theySeeWhatIsSaid(one, other);
  await aThreadHangsFromIt(one, other);
  await aPictureArrives(one, other);
  await searchingFindsIt(one);
  await aDraftSurvivesLeaving(one, channel);

  server.close();
  report(true, "two people talked, threaded, attached, searched and kept a draft");
}

/** Made with nobody in it: who is in it is the next step's business. */
async function makeTheChannel(page, name) {
  await run(
    page,
    `document.getElementById("new-button").click();
    document.querySelector('[data-opens="create-channel"]').click();`
  );
  await waitFor(page, "the create dialog", `document.getElementById("create-channel").open`, 20);
  // Public on purpose, twice over: what is said has to be readable by a browser that was not there when it
  // was said, and a public channel is one somebody can find and walk into.
  await run(
    page,
    `
    document.getElementById("channel-name").value = ${JSON.stringify(name)};
    document.querySelector('input[name="visibility"][value="public"]').checked = true;
    document.querySelector('#create-channel button[value="create"]').click();
  `
  );
  detail.channel = name;
  await new Promise(resolve => setTimeout(resolve, 3000));
  console.log(
    "after creating:",
    await read(page, `document.getElementById("channels").textContent.replace(/\\s+/g, " ").slice(0, 200)`)
  );
  console.log("wrong:", await read(page, `document.getElementById("sign-in-wrong").textContent`));
  console.log("dialog said:", await read(page, `document.getElementById("create-channel").returnValue`));
}

/** The other side finds it in the list of public channels and walks in, which is the whole of that screen. */
async function theOtherWalksIn(page, name) {
  await run(
    page,
    `document.getElementById("new-button").click();
    document.querySelector('[data-opens="explore"]').click();`
  );
  await waitFor(page, "the explore dialog", `document.getElementById("explore").open`, 20);
  await run(
    page,
    `
    document.getElementById("explore-search").value = ${JSON.stringify(name)};
    document.getElementById("explore-search").dispatchEvent(new Event("input"));
  `
  );
  await waitFor(page, `#${name} to be findable`, `document.querySelector("[data-joins]") !== null`, 90);
  await run(page, `document.querySelector("[data-joins]").click();`);
  await waitFor(
    page,
    "the other side to be in",
    `document.getElementById("open-title").textContent.includes(${JSON.stringify(name)})`,
    60
  );
}

async function theySeeWhatIsSaid(one, other) {
  const body = `hola desde la comprobación ${Date.now()}`;
  await run(
    one,
    `
    document.getElementById("write").value = ${JSON.stringify(body)};
    document.getElementById("composer").requestSubmit();
  `
  );
  await waitFor(other, "the message to arrive", `${said}.includes(${JSON.stringify(body)})`, 60);
  detail.said = body;
}

async function aThreadHangsFromIt(one, other) {
  await run(other, `document.querySelector("[data-hangs-from]").click();`);
  await waitFor(other, "the thread to open", `!document.getElementById("thread").hidden`, 20);
  const answer = `en el hilo ${Date.now()}`;
  await run(
    other,
    `
    document.getElementById("thread-write-body").value = ${JSON.stringify(answer)};
    document.getElementById("thread-write").requestSubmit();
  `
  );
  // The other side learns about it as a pill under the message, not as a line in the conversation.
  await waitFor(one, "the thread pill", `document.querySelector("[data-opens-thread]") !== null`, 90);
  await run(one, `document.querySelector("[data-opens-thread]").click();`);
  await waitFor(
    one,
    "the answer inside the thread",
    `document.getElementById("thread-body").textContent.includes(${JSON.stringify(answer)})`,
    30
  );
  const leaked = await read(one, `${said}.includes(${JSON.stringify(answer)})`);
  if (leaked) throw new Error("a thread answer landed in the middle of the conversation");
  await run(one, `document.getElementById("thread-close").click();`);
  detail.thread = answer;
}

async function aPictureArrives(one, other) {
  await run(
    one,
    `
    window.__picture = (async () => {
      const bytes = new Uint8Array(await (await fetch("data:image/png;base64," +
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")).arrayBuffer());
      const file = new File([bytes], "punto.png", { type: "image/png" });
      const box = document.getElementById("attachment");
      const holder = new DataTransfer();
      holder.items.add(file);
      box.files = holder.files;
      box.dispatchEvent(new Event("change"));
    })();
  `
  );
  await waitFor(
    other,
    "the picture to be drawn as a picture",
    `document.querySelectorAll("#timeline img.shown").length > 0`,
    90
  );
  detail.picture = "punto.png";
}

async function searchingFindsIt(page) {
  const words = detail.said.split(" ").slice(0, 3).join(" ");
  await run(
    page,
    `
    document.getElementById("search").value = ${JSON.stringify(words)};
    document.getElementById("search").dispatchEvent(new Event("input"));
  `
  );
  await waitFor(page, "a search result", `document.querySelectorAll("#results-list .found").length > 0`, 30);
  await run(page, `document.getElementById("results-close").click();`);
}

async function aDraftSurvivesLeaving(page, channel) {
  const halfWritten = `a medias ${Date.now()}`;
  await run(
    page,
    `
    document.getElementById("write").value = ${JSON.stringify(halfWritten)};
    document.getElementById("write").dispatchEvent(new Event("input"));
  `
  );
  // Long enough for what is typed to be put away, which is deliberately not on every keystroke.
  await new Promise(resolve => setTimeout(resolve, 1500));
  // Somewhere else and back again. A fresh account has nowhere else, so the search results stand in for it:
  // what matters is that the box was left and came back, not where it went.
  await run(
    page,
    `
    document.getElementById("search").value = "nada de nada";
    document.getElementById("search").dispatchEvent(new Event("input"));
  `
  );
  await waitFor(page, "the conversation to be left", `!document.getElementById("results").hidden`, 30);
  await run(page, `document.getElementById("results-close").click();`);
  await run(page, `document.getElementById("write").value = "";`);
  await openChannel(page, channel, "alice");
  await waitFor(
    page,
    "what was half written to come back",
    `document.getElementById("write").value === ${JSON.stringify(halfWritten)}`,
    30
  );
  detail.draft = halfWritten;
}

app
  .whenReady()
  .then(main)
  .catch(error => report(false, error.message));
