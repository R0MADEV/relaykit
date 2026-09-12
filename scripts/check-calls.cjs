"use strict";
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { serve, acceptOwnCertificate, waitFor } = require("./browser-harness.cjs");

// Two browsers ringing each other, which is the only way a call can be checked at all.
//
// The other checks prove that placing a call starts one and that hanging up ends it. They cannot prove more,
// because nobody is on the other side: a call with no answer never leaves `connecting`, so the negotiation
// that follows an answer is never exercised and `answer` against a real homeserver is never run.
//
// Here alice rings and bob answers, and both have to reach `connected`. There is no camera and no microphone:
// Chromium is told to make up a tone and a picture, which is what lets this run where there is no hardware
// and nobody to grant permission.
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");

const root = path.join(__dirname, "..", "examples", "web", "dist");
const detail = {};

function report(ok, summary) {
  console.log(`RELAYKIT_CALLS_RESULT ${JSON.stringify({ ok, summary, detail })}`);
  app.exit(ok ? 0 : 1);
}

/** A window of its own for each person: two people sharing a store is two people sharing an identity. */
async function open(who, address) {
  const page = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { partition: `persist:${who}` }
  });
  page.webContents.on("render-process-gone", (_event, details) =>
    report(false, `the page for ${who} died: ${details.reason}`));
  acceptOwnCertificate(page.webContents.session);
  await page.loadURL(address);

  await waitFor(page, `the sign in form for ${who}`, `document.getElementById("login-form") !== null`);
  await page.webContents.executeJavaScript(`
    document.getElementById("username").value = ${JSON.stringify(who)};
    document.getElementById("password").value = ${JSON.stringify(`${who}-password`)};
    document.getElementById("login-form").requestSubmit();
    true;
  `);
  await waitFor(page, `${who} to be signed in`, `document.getElementById("app").hidden === false`, 40);
  return page;
}

/** Whatever the call is doing now, as this side sees it. Undefined once it is over. */
function stateOfTheCall(page, callId) {
  return page.webContents.executeJavaScript(`
    window.relaykitDemo.client.calls.list()
      .then(calls => calls.find(call => call.id === ${JSON.stringify(callId)})?.state ?? "over")
  `);
}

async function run() {
  const server = await serve(root);
  const address = `https://127.0.0.1:${server.address().port}/`;
  const alice = await open("alice", address);
  const bob = await open("bob", address);
  detail.bothSignedIn = true;

  // Bob keeps whatever call arrives, from now on, so that none is missed while something else is awaited.
  await bob.webContents.executeJavaScript(`
    window.arrived = null;
    window.relaykitDemo.client.on("call.incoming", call => { window.arrived = call; });
    true;
  `);

  const conversationId = await alice.webContents.executeJavaScript(`
    window.relaykitDemo.client.conversations.open("@bob:localhost").then(conversation => conversation.id)
  `);
  detail.conversationId = conversationId;

  // An invitation is not a conversation yet: bob has to be in the room to be rung in it.
  await waitFor(bob, "bob to see the invitation", `
    window.relaykitDemo.client.conversations.list()
      .then(list => list.some(item => item.id === ${JSON.stringify(conversationId)}))
  `);
  await bob.webContents.executeJavaScript(`
    window.relaykitDemo.client.conversations.join(${JSON.stringify(conversationId)}).then(() => true)
  `);
  detail.bobJoined = true;

  const placed = await alice.webContents.executeJavaScript(`
    window.relaykitDemo.client.calls.place(${JSON.stringify(conversationId)}, { video: false })
  `);
  detail.placed = placed.state;

  const arrived = await waitFor(bob, "the call to reach bob", `window.arrived`);
  detail.arrivedAtBob = arrived.state;

  await bob.webContents.executeJavaScript(`
    window.relaykitDemo.client.calls.answer(window.arrived.id, { video: false }).then(() => true)
  `);

  // Both sides, because a call that only one side thinks is connected is not a call.
  detail.aliceReached = await waitFor(alice, "alice to be connected",
    `window.relaykitDemo.client.calls.list().then(calls => calls.some(call => call.state === "connected") && "connected")`);
  detail.bobReached = await waitFor(bob, "bob to be connected",
    `window.relaykitDemo.client.calls.list().then(calls => calls.some(call => call.state === "connected") && "connected")`);

  await alice.webContents.executeJavaScript(`
    window.relaykitDemo.client.calls.hangUp(${JSON.stringify(placed.id)}).then(() => true)
  `);

  // Hanging up is told to the other side over Matrix, so bob has to find out without being asked.
  await waitFor(alice, "the call to be over for alice",
    `window.relaykitDemo.client.calls.list().then(calls => calls.length === 0)`);
  await waitFor(bob, "the call to be over for bob",
    `window.relaykitDemo.client.calls.list().then(calls => calls.length === 0)`);
  detail.hungUpOnBothSides = true;

  server.close();
  report(true, "two browsers rang each other, answered and hung up");
}

app.whenReady().then(() => run().catch(error => report(false, error.message)));
