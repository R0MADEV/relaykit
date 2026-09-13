"use strict";
// Takes a picture of the example as alice sees it, for looking at what it looks like without a person.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { serve, acceptOwnCertificate, waitFor } = require("./browser-harness.cjs");

app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
const root = path.join(__dirname, "..", "examples", "web", "dist");
const out = process.env.RELAYKIT_SNAP_OUT ?? "/tmp/relaykit-demo.png";

async function run() {
  const server = await serve(root);
  const address = `https://127.0.0.1:${server.address().port}/?conference=http://localhost:8091`;
  const page = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { partition: "persist:snap-alice" } });
  acceptOwnCertificate(page.webContents.session);
  page.webContents.session.setPermissionRequestHandler((_c, permission, callback) => callback(permission === "media"));
  await page.loadURL(address);
  await waitFor(page, "login", `document.getElementById("login-form") !== null`);
  await page.webContents.executeJavaScript(`
    document.getElementById("username").value = "alice";
    document.getElementById("password").value = "alice-password";
    document.getElementById("login-form").requestSubmit(); true;`);
  await waitFor(page, "signed in", `document.getElementById("app").hidden === false`, 40);
  await waitFor(page, "a conversation", `document.querySelectorAll("#conversations li").length > 0`, 40);
  await page.webContents.executeJavaScript(`document.querySelector("#conversations li").click(); true;`);
  await waitFor(page, "the timeline", `!document.getElementById("timeline").hidden`, 40);
  await new Promise(resolve => setTimeout(resolve, 1500));
  if (process.env.RELAYKIT_SNAP_CALL) {
    await page.webContents.executeJavaScript(`document.getElementById("video-call").click(); true;`);
    await waitFor(page, "the call", `!document.getElementById("call-panel").hidden`, 40);
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  const image = await page.capturePage();
  fs.writeFileSync(out, image.toPNG());
  await page.webContents.executeJavaScript(`window.relaykitDemo.client.logout().then(() => true, () => true)`);
  server.close();
  console.log(`RELAYKIT_SNAP ${out}`);
  app.exit(0);
}
app.whenReady().then(() => run().catch(error => { console.error(`snap failed: ${error.message}`); app.exit(1); }));
