"use strict";
// Takes a picture of each screen of the application, signed in against the development homeserver.
//
// The screens are drawn from what the homeserver says now, so this is the only way to see whether the wiring
// holds: a picture of stand-in content only ever proves the CSS.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { serve, acceptOwnCertificate, waitFor } = require("./browser-harness.cjs");

app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");

const root = path.join(__dirname, "..", "examples", "web", "dist");
const out = process.env.RELAYKIT_SNAP_OUT ?? "/tmp";
const who = process.env.RELAYKIT_SNAP_WHO ?? "alice";
const homeserver = process.env.RELAYKIT_SNAP_HOMESERVER ?? "http://localhost:8008";
const wanted = process.env.RELAYKIT_SNAP_OPEN ?? "incidencias-voz";

/** Each shot: what to do to the page first, and what to call the picture. */
const shots = [
  {
    // Waits for the last thing to arrive, which is what hangs off the messages: a picture taken before that
    // is a picture of a conversation still loading.
    name: "chat",
    needs: `document.querySelector("[data-opens-thread]") !== null`,
    does: ""
  },
  {
    name: "thread",
    does: `document.querySelector("[data-opens-thread]").click();`,
    waitsFor: `document.querySelectorAll("#thread-body .said").length > 1`
  },
  {
    // Opened, not pressed: making a recovery key on a real account replaces the backup its other devices use.
    name: "recovery",
    needs: `!document.getElementById("keys").hidden`,
    does: `document.getElementById("keys-act").click();`,
    waitsFor: `document.getElementById("recovery").open`
  },
  { name: "account", does: `document.getElementById("me").click();` },
  {
    name: "who",
    does: `document.getElementById("more-button").click();
      document.getElementById("people-here").click();`,
    waitsFor: `document.querySelectorAll("#who-list li").length > 0`,
    seconds: 20
  },
  {
    name: "settings",
    does: `document.getElementById("more-button").click();
      document.getElementById("settings-here").click();`,
    waitsFor: `document.getElementById("settings").open`
  },
  {
    name: "create-channel",
    does: `document.getElementById("new-button").click();
      document.querySelector('[data-opens="create-channel"]').click();`
  },
  {
    name: "room",
    does: `document.getElementById("open-room").click();`,
    waitsFor: `document.querySelectorAll("#grid .seat").length > 0 || !document.getElementById("lobby-view").hidden`,
    seconds: 40
  },
  { name: "invite", does: `document.querySelector('[data-opens="invite"]').click();` },
  { name: "mini", does: `document.getElementById("minimise").click();` }
];

async function run() {
  const server = await serve(root);
  const page = new BrowserWindow({
    show: false,
    width: Number(process.env.RELAYKIT_SNAP_WIDTH ?? 1440),
    height: Number(process.env.RELAYKIT_SNAP_HEIGHT ?? 900),
    webPreferences: { partition: `persist:snap-${who}` }
  });
  acceptOwnCertificate(page.webContents.session);
  page.webContents.session.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(permission === "media")
  );
  page.webContents.session.setPermissionCheckHandler((_contents, permission) => permission === "media");
  page.webContents.setAudioMuted(true);
  page.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2 || process.env.RELAYKIT_SNAP_VERBOSE) console.error(`[page] ${message}`);
  });

  const address = `https://127.0.0.1:${server.address().port}/app.html?conference=http://localhost:8091`;
  console.log("opening", address);
  await page.loadURL(address);
  await signIn(page);
  console.log("signed in");
  console.log(
    "state",
    await page.webContents.executeJavaScript(`JSON.stringify({
      title: document.getElementById("open-title").textContent,
      rows: document.querySelectorAll("#channels li, #directs li").length,
      current: document.querySelectorAll('[aria-current]').length,
      said: document.querySelectorAll("#timeline .said").length,
      pills: document.querySelectorAll("[data-opens-thread]").length,
      shown: document.querySelectorAll("#timeline img.shown").length,
      wrong: document.getElementById("sign-in-wrong").textContent,
      keys: document.getElementById("keys").hidden ? "hidden" : document.getElementById("keys-title").textContent
    })`)
  );

  for (const shot of shots) {
    // A screen that needs something this account does not have — a thread where nobody started one — is
    // worth saying out loud and stepping over, not worth stopping the rest of the pictures for.
    try {
      // Whatever the last shot opened is shut first: a dialog left up is in the way of the next picture.
      await page.webContents.executeJavaScript(
        `document.querySelectorAll("dialog[open]").forEach(each => each.close()); true;`
      );
      if (shot.needs) await waitFor(page, `${shot.name} to be there`, shot.needs, 30);
      if (shot.does) await page.webContents.executeJavaScript(`${shot.does} true;`);
      if (shot.waitsFor) await waitFor(page, shot.name, shot.waitsFor, shot.seconds ?? 10);
    } catch (wrong) {
      console.log(`${shot.name} -> skipped: ${wrong.message}`);
      continue;
    }
    await settle(page);
    const picture = await page.webContents.capturePage();
    require("node:fs").writeFileSync(path.join(out, `app-${shot.name}.png`), picture.toPNG());
    console.log(`${shot.name} -> ${path.join(out, `app-${shot.name}.png`)}`);
  }
  // Hung up before leaving: a call the pictures placed and never ended is a room left open on the homeserver,
  // and the next run of this would find it in the history of the conversation it is photographing.
  await page.webContents
    .executeJavaScript(`document.getElementById("hang-up").click(); true;`)
    .catch(() => undefined);
  await settle(page, 1500);
  server.close();
  app.exit(0);
}

async function signIn(page) {
  await waitFor(page, "the sign in form", `!document.getElementById("sign-in").hidden`, 20);
  console.log("the form is up");
  await page.webContents.executeJavaScript(`
    document.getElementById("homeserver").value = ${JSON.stringify(homeserver)};
    document.getElementById("username").value = ${JSON.stringify(who)};
    document.getElementById("password").value = ${JSON.stringify(`${who}-password`)};
    document.getElementById("sign-in").requestSubmit();
    true;
  `);
  await waitFor(page, "the shell", `!document.getElementById("shell").hidden`, 60);
  console.log("the shell is up");
  // The first conversation opens on its own once the list arrives, and there is nothing to photograph before it.
  await waitFor(
    page,
    "something to read",
    `document.querySelectorAll("#channels li, #directs li").length > 0`,
    60
  );
  // The one the seed built, which is the only one with a thread and reactions in it. Whatever the account
  // happens to open on is not what these pictures are of.
  const named = `[...document.querySelectorAll("#channels li button")].find(row => row.textContent.includes(${JSON.stringify(wanted)}))`;
  await waitFor(page, `the ${wanted} channel`, `Boolean(${named})`, 60);
  await page.webContents.executeJavaScript(`${named}.click(); true;`);
  await settle(page, 2500);
}

function settle(page, milliseconds = 400) {
  return page.webContents.executeJavaScript(`new Promise(r => setTimeout(() => r(true), ${milliseconds}))`);
}

app.whenReady().then(run);
