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

// Ends the run, and hands back the account it registered before it goes: a check that leaves accounts
// behind fills the homeserver's people directory, which is the directory the example searches.
async function report(ok, summary) {
  const { closeWhatWasMade } = await import("./fresh-accounts.mjs");
  await closeWhatWasMade().catch(() => undefined);
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
  await page.loadURL(`https://127.0.0.1:${server.address().port}/`);
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
  // Two, because leaving a conversation and coming back is what a draft has to survive.
  const somewhereElse = `otra-${Date.now()}`;
  await makeTheChannel(one, somewhereElse);
  await makeTheChannel(one, channel);
  await openChannel(one, channel, "alice");
  await theOtherWalksIn(other, channel);

  await aDirectStaysDirect(one, other, bob, channel);
  await theySeeWhatIsSaid(one, other);
  await aThreadHangsFromIt(one, other);
  await aPictureArrives(one, other);
  await searchingFindsIt(one);
  await aDraftSurvivesLeaving(one, channel, somewhereElse);

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
  `
  );
  await run(page, `document.querySelector('#create-channel button[value="create"]').click();`);
  // Waited for rather than assumed: a person sees the channel appear before they do anything else, and
  // opening the dialog again while the last one is still being made is how two channels end up with one name.
  await waitFor(
    page,
    `#${name} to appear in the list`,
    `[...document.querySelectorAll(".lists li button")].some(each => each.textContent.includes(${JSON.stringify(name)}))`,
    60
  );
  detail.channel = name;
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
  // By name, not the first row: the homeserver's directory answers loosely and this account has more than
  // one public channel.
  const row = `[...document.querySelectorAll("#explore-found li")].find(each => each.textContent.includes(${JSON.stringify(name)}))`;
  await waitFor(page, `#${name} to be findable`, `Boolean(${row})`, 90);
  await run(page, `${row}.querySelector("[data-joins]").click();`);
  // Pressed the way a person presses it, and the banner has to go: joining changes that one conversation
  // and nothing else, so a screen that only repaints the list beside it leaves the invitation showing.
  await waitFor(
    page,
    "the other side to be in",
    `document.getElementById("open-title").textContent.includes(${JSON.stringify(name)})`,
    60
  );
}

/**
 * A conversation between two people is one on both screens, and stays one after a reload.
 *
 * Which side of it you are on should not change what it is. The one who starts it writes the record of it in
 * their own account data and the one who accepts has to write theirs, and getting that wrong means the same
 * conversation is a direct chat on one screen and a channel on the other — with the room's identifier
 * standing in for a name, because a channel with no name has none.
 */
async function aDirectStaysDirect(one, other, otherAccount, goBackTo) {
  // Through the screen, the way a person does it: the picker, the name, the row, the button.
  await run(
    one,
    `document.querySelector('[data-opens="new-message"]').click();
     document.getElementById("new-message-search").value = ${JSON.stringify(otherAccount.username)};
     document.getElementById("new-message-search").dispatchEvent(new Event("input"));`
  );
  await waitFor(
    one,
    "the other person to be findable",
    `document.querySelector('#new-message-people [data-picks="${otherAccount.userId}"]') !== null`,
    60
  );
  await run(
    one,
    `document.querySelector('#new-message-people [data-picks="${otherAccount.userId}"]').click();
     document.getElementById("new-message").querySelector('[value="start"]').click();`
  );
  const isADirect = section =>
    `[...document.querySelectorAll("#${section} li")].some(row =>
       row.textContent.includes(${JSON.stringify(otherAccount.username)}))`;

  await waitFor(one, "the direct conversation on the side that started it", isADirect("directs"), 60);
  // And it is not also sitting among the channels, which is what a lost mark looks like.
  detail.startedItSeesAChannel = await read(one, isADirect("channels"));
  if (detail.startedItSeesAChannel) throw new Error("the side that started it sees a channel as well");

  // Reloaded, because that is when a screen paints from what it wrote down rather than from what it did.
  await one.reload();
  await waitFor(one, "it to still be a direct conversation after a reload", isADirect("directs"), 90);
  detail.directSurvivedAReload = true;

  // And the other side, which is the harder half: they were invited, and accepting is what has to be written
  // down. Their screen knew it was a direct chat from the invitation; a reload paints from what was kept.
  const theirs = `[...document.querySelectorAll("#directs li")].some(row =>
    row.textContent.includes("chat-a") || row.textContent.includes("alice"))`;
  await waitFor(other, "the invitation to arrive", `document.querySelectorAll("#directs li").length > 0`, 60);
  await run(other, `document.querySelector("#directs li button").click();`);
  await waitFor(other, "the invitation banner", `!document.getElementById("invited").hidden`, 30);
  await run(other, `document.getElementById("accept-invitation").click();`);
  await waitFor(other, "the invitation to be accepted", `document.getElementById("invited").hidden`, 60);

  await other.reload();
  await waitFor(other, "the accepted direct to still be direct after a reload", theirs, 90);
  // The symptom is not that it disappears, it is that it turns up filed as a channel.
  detail.acceptedItSeesAChannel = await read(
    other,
    `[...document.querySelectorAll("#channels li")].some(row => row.textContent.includes("chat-a"))`
  );
  if (detail.acceptedItSeesAChannel) throw new Error("the side that accepted sees a channel after a reload");
  detail.acceptedDirectSurvivedAReload = true;
  await openChannel(other, goBackTo, "bob");

  // Put back where the rest of this check expects to find it: reloading opened whatever came first.
  await openChannel(one, goBackTo, "alice");
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

async function aDraftSurvivesLeaving(page, channel, somewhereElse) {
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
  // Somewhere else and back again, which is the whole of what a draft has to survive.
  await openChannel(page, somewhereElse, "alice");
  await waitFor(
    page,
    "the other conversation to be empty",
    `document.getElementById("write").value === ""`,
    30
  );
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
