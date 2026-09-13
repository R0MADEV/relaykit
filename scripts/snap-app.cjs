"use strict";
// Takes a picture of each screen of the design, for looking at what it looks like without a person.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { serve, acceptOwnCertificate } = require("./browser-harness.cjs");

const root = path.join(__dirname, "..", "examples", "web", "dist");
const out = process.env.RELAYKIT_SNAP_OUT ?? "/tmp";

/** Each shot: what to do to the page first, and what to call the picture. */
const shots = [
  { name: "chat", does: "" },
  { name: "thread", does: `document.getElementById("open-thread").click();` },
  { name: "create-channel", does: `document.getElementById("create-channel").showModal();` },
  { name: "invite", does: `document.getElementById("invite").showModal();` },
  { name: "room", does: `document.getElementById("enter-room").click();` },
  { name: "lobby", does: `document.getElementById("open-room").click();` },
  { name: "mini", does: `document.getElementById("minimise").click();` }
];

async function run() {
  const server = await serve(root);
  const page = new BrowserWindow({ show: false, width: 1440, height: 900 });
  acceptOwnCertificate(page.webContents.session);

  for (const shot of shots) {
    await page.loadURL(`https://127.0.0.1:${server.address().port}/app.html`);
    await page.webContents.executeJavaScript(`new Promise(r => requestAnimationFrame(() => r(true)))`);
    if (shot.does) await page.webContents.executeJavaScript(`${shot.does} true;`);
    await page.webContents.executeJavaScript(`new Promise(r => setTimeout(() => r(true), 120))`);
    const picture = await page.webContents.capturePage();
    require("node:fs").writeFileSync(path.join(out, `app-${shot.name}.png`), picture.toPNG());
    console.log(`${shot.name} -> ${path.join(out, `app-${shot.name}.png`)}`);
  }
  server.close();
  app.exit(0);
}

app.whenReady().then(run);
