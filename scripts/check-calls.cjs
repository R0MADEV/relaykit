"use strict";
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { serve, acceptOwnCertificate, fitAMakeBelieveMicrophone, waitFor } = require("./browser-harness.cjs");

// Two browsers ringing each other, which is the only way a call can be checked at all.
//
// The other checks prove that placing a call starts one and that hanging up ends it. They cannot prove more,
// because nobody is on the other side: a call with no answer never leaves `connecting`, so the negotiation
// that follows an answer is never exercised and `answer` against a real homeserver is never run.
//
// Here alice rings and bob answers, and both have to reach `connected`. There is no camera and no microphone,
// and asking the machine for one never comes back: the capture that Chromium does through macOS hangs here
// even with its own made up devices, so the page is handed a microphone made in the page instead (see
// `fitAMakeBelieveMicrophone`). What this checks is the call itself, not whether a real microphone opens.
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
  // Nobody is here to answer a permission prompt, so every media question is said yes to. This is not what
  // makes the call work — the made up microphone below is — but it keeps the sdk from being told no.
  page.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === "media");
  });
  page.webContents.session.setPermissionCheckHandler((_contents, permission) => permission === "media");
  await page.loadURL(address);

  await waitFor(page, `the sign in form for ${who}`, `document.getElementById("login-form") !== null`);
  await page.webContents.executeJavaScript(`
    document.getElementById("username").value = ${JSON.stringify(who)};
    document.getElementById("password").value = ${JSON.stringify(`${who}-password`)};
    document.getElementById("login-form").requestSubmit();
    true;
  `);
  await waitFor(page, `${who} to be signed in`, `document.getElementById("app").hidden === false`, 40);
  await fitAMakeBelieveMicrophone(page);
  return page;
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

  // Opened the way a person opens it: the picker, not the API. What is being checked is that a call can be
  // placed and answered from the screen, so the screen is what is used.
  await alice.webContents.executeJavaScript(`
    document.getElementById("participant").value = "@bob:localhost";
    document.getElementById("open-form").requestSubmit();
    true;
  `);
  const conversationId = await waitFor(alice, "the conversation with bob", `
    window.relaykitDemo.client.conversations.list()
      .then(list => list.find(item => item.isDirect && item.participantIds.includes("@bob:localhost"))?.id ?? false)
  `);
  detail.conversationId = conversationId;

  // An invitation is not a conversation yet: bob has to be in the room to be rung in it. Setting up, not the
  // thing being checked, so it is asked for plainly.
  await waitFor(bob, "bob to see the invitation", `
    window.relaykitDemo.client.conversations.list()
      .then(list => list.some(item => item.id === ${JSON.stringify(conversationId)}))
  `);
  await bob.webContents.executeJavaScript(`
    window.relaykitDemo.client.conversations.join(${JSON.stringify(conversationId)}).then(() => true)
  `);
  detail.bobJoined = true;

  await alice.webContents.executeJavaScript(`document.getElementById("call").click(); true;`);
  detail.aliceCalled = await waitFor(alice, "alice's call panel", `
    !document.getElementById("call-panel").hidden && document.getElementById("call-state").textContent
  `);
  // The very first thing the screen says has to be right. Whose call it is is known before the SDK has
  // written down which way it goes, and a screen that draws a call from nobody is what that looked like.
  if (!detail.aliceCalled.startsWith("Llamando")) {
    throw new Error(`Alice placed the call and her screen says: ${detail.aliceCalled}`);
  }

  // Bob's screen has to ring on its own, and the button to answer has to be the one that is showing.
  detail.bobWasRung = await waitFor(bob, "bob's screen to ring", `
    !document.getElementById("answer").hidden && document.getElementById("call-state").textContent
  `);
  await bob.webContents.executeJavaScript(`document.getElementById("answer").click(); true;`);

  // Connected is not the same as audible. What has to be true is that the element on the screen has been given
  // a stream with a live track on it, which is the whole point of a call.
  const playing = `
    (() => {
      const media = document.getElementById("call-media").srcObject;
      const tracks = media ? media.getAudioTracks() : [];
      return tracks.some(track => track.readyState === "live") && { tracks: tracks.length };
    })()
  `;
  detail.aliceHears = await waitFor(alice, "alice's screen to be playing bob", playing);
  detail.bobHears = await waitFor(bob, "bob's screen to be playing alice", playing);

  await alice.webContents.executeJavaScript(`document.getElementById("hang-up").click(); true;`);

  // Hanging up is told to the other side over Matrix, so bob's screen has to put itself away without being
  // touched.
  await waitFor(alice, "alice's call panel to go away", `document.getElementById("call-panel").hidden`);
  await waitFor(bob, "bob's call panel to go away", `document.getElementById("call-panel").hidden`);
  detail.hungUpOnBothSides = true;

  server.close();
  report(true, "two browsers rang each other, answered and hung up");
}

app.whenReady().then(() => run().catch(error => report(false, error.message)));
