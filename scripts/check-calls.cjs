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
  // The made up microphone is a tone, and the other side plays what it receives: without this the check comes
  // out of whoever is running it's speakers. Silenced at the window, so the page is left as it is and what is
  // checked stays the same: that the tracks arrive live, not that anybody can hear them.
  page.webContents.setAudioMuted(true);
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

/**
 * One whole call, from the screen: alice presses, bob's screen rings on its own, bob answers, both have to end
 * up playing what the other is sending, and hanging up has to reach the other side.
 *
 * Voice and video go the same way and differ in one thing that matters: whether there is anything to look at.
 */
async function ring(alice, bob, { video }) {
  const kind = video ? "video" : "voice";
  const said = {};

  await alice.webContents.executeJavaScript(
    `document.getElementById(${JSON.stringify(video ? "video-call" : "call")}).click(); true;`);
  said.aliceCalled = await waitFor(alice, `alice's ${kind} call panel`, `
    !document.getElementById("call-panel").hidden && document.getElementById("call-state").textContent
  `);
  // The very first thing the screen says has to be right. Whose call it is is known before the SDK has
  // written down which way it goes, and a screen that draws a call from nobody is what that looked like.
  if (!said.aliceCalled.startsWith("Llamando")) {
    throw new Error(`Alice placed the call and her screen says: ${said.aliceCalled}`);
  }

  // Bob's screen has to ring on its own, and the button to answer has to be the one that is showing.
  said.bobWasRung = await waitFor(bob, `bob's screen to ring for a ${kind} call`, `
    !document.getElementById("answer").hidden && document.getElementById("call-state").textContent
  `);
  await bob.webContents.executeJavaScript(`document.getElementById("answer").click(); true;`);

  // Connected is not the same as heard or seen. What has to be true is that the element on the screen has been
  // given a stream with live tracks on it, which is the whole point of a call.
  const playing = `
    (() => {
      const media = document.getElementById("call-media").srcObject;
      if (!media) return false;
      const live = kinds => kinds.filter(track => track.readyState === "live").length;
      const heard = live(media.getAudioTracks());
      const seen = live(media.getVideoTracks());
      if (heard === 0) return false;
      if (${video} && seen === 0) return false;
      return { heard, seen, onScreen: !document.getElementById("call-media").hidden };
    })()
  `;
  said.alice = await waitFor(alice, `alice's screen to be playing bob's ${kind}`, playing);
  said.bob = await waitFor(bob, `bob's screen to be playing alice's ${kind}`, playing);

  // A video call has a picture to show and a voice call has not: keeping room for one that will never come
  // leaves a hole on the screen.
  for (const [who, what] of [["alice", said.alice], ["bob", said.bob]]) {
    if (what.onScreen !== video) {
      throw new Error(video
        ? `A video call is not showing the picture on ${who}'s screen`
        : `A voice call is keeping a hole on ${who}'s screen for a picture that will never come`);
    }
  }

  // The same from the screen, which is where somebody actually does it: press, and the call has to say so.
  const pressing = async (button, saying) => {
    await alice.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(button)}).click(); true;`);
    return waitFor(alice, `the call to say ${saying} after pressing ${button}`, `
      window.relaykitDemo.client.calls.list().then(calls => calls[0]?.${saying} === true)
    `);
  };
  said.pressedSilence = await pressing("call-mute", "isMicrophoneMuted");
  await alice.webContents.executeJavaScript(`document.getElementById("call-mute").click(); true;`);
  said.pressedHold = await pressing("call-hold", "isOnHold");
  await alice.webContents.executeJavaScript(`document.getElementById("call-hold").click(); true;`);
  if (video) {
    said.pressedCamera = await pressing("call-camera", "isCameraMuted");
    await alice.webContents.executeJavaScript(`document.getElementById("call-camera").click(); true;`);
  }

  // Silencing has to reach the track. A flag that says silenced while the microphone is still sending is
  // worse than no button at all, and only a real call can tell one from the other.
  const track = video ? "getVideoTracks" : "getAudioTracks";
  const silence = muted => `
    window.relaykitDemo.client.calls.list().then(async calls => {
      const call = calls[0];
      await window.relaykitDemo.client.calls.${video ? "muteCamera" : "muteMicrophone"}(call.id, ${muted});
      const now = (await window.relaykitDemo.client.calls.list())[0];
      return {
        says: ${video ? "now.isCameraMuted" : "now.isMicrophoneMuted"},
        sending: now.ownMedia.${track}().some(one => one.enabled)
      };
    })
  `;
  said.silenced = await alice.webContents.executeJavaScript(silence(true));
  if (!said.silenced.says || said.silenced.sending) {
    throw new Error(`Silencing did not reach the track: ${JSON.stringify(said.silenced)}`);
  }
  said.spokeAgain = await alice.webContents.executeJavaScript(silence(false));
  if (said.spokeAgain.says || !said.spokeAgain.sending) {
    throw new Error(`Letting it speak again did not reach the track: ${JSON.stringify(said.spokeAgain)}`);
  }

  // Hold is told to the other side, so it is asked of both.
  said.held = await alice.webContents.executeJavaScript(`
    window.relaykitDemo.client.calls.list().then(async calls => {
      await window.relaykitDemo.client.calls.hold(calls[0].id, true);
      return (await window.relaykitDemo.client.calls.list())[0].isOnHold;
    })
  `);
  if (!said.held) throw new Error("A call was put on hold and does not say so");
  await alice.webContents.executeJavaScript(`
    window.relaykitDemo.client.calls.list()
      .then(calls => window.relaykitDemo.client.calls.hold(calls[0].id, false)).then(() => true)
  `);

  await alice.webContents.executeJavaScript(`document.getElementById("hang-up").click(); true;`);

  // Hanging up is told to the other side over Matrix, so bob's screen has to put itself away without being
  // touched.
  await waitFor(alice, `alice's ${kind} call panel to go away`, `document.getElementById("call-panel").hidden`);
  await waitFor(bob, `bob's ${kind} call panel to go away`, `document.getElementById("call-panel").hidden`);
  said.hungUpOnBothSides = true;

  detail[kind] = said;
}

/**
 * Refusing a call, which is not hanging one up: nobody answered, and the other side has to be told so and put
 * its own screen away.
 */
async function refuse(alice, bob) {
  await alice.webContents.executeJavaScript(`document.getElementById("call").click(); true;`);
  await waitFor(bob, "bob's screen to ring before refusing", `!document.getElementById("reject").hidden`);
  await bob.webContents.executeJavaScript(`document.getElementById("reject").click(); true;`);

  await waitFor(bob, "bob's screen to put itself away after refusing",
    `document.getElementById("call-panel").hidden`);
  await waitFor(alice, "alice to be told the call was refused",
    `document.getElementById("call-panel").hidden`);
  detail.refused = true;
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

  await ring(alice, bob, { video: false });
  await ring(alice, bob, { video: true });
  await refuse(alice, bob);

  server.close();
  report(true, "two browsers rang each other by voice and by video, answered and hung up");
}

app.whenReady().then(() => run().catch(error => report(false, error.message)));
