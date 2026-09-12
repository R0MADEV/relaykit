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
// Here alice rings and bob answers, and both have to reach `connected`. There is no camera and no microphone
// on the machine, so Chromium is told to make up a tone and a moving picture of its own. Those behave like
// devices in every way that matters: they have identifiers, they can be switched off and asked for again.
//
// This used to hand the page a microphone built inside it, and that quietly cost a feature: turning the
// camera back on after putting it away needs the media asked for afresh, and a stream made in the page is not
// a device to ask again for. It looked like the library could not bring a camera back. It could.
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
  // Pressed, and then waited on until the call says it took. Firing the next one blind is how a check ends up
  // asking for something while the call is still agreeing the last one with the other side, and the SDK says
  // no to that — rightly, and an application would see the same.
  const pressing = async (button, saying, expected) => {
    await alice.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(button)}).click(); true;`);
    return waitFor(alice, `the call to say ${saying} is ${expected} after pressing ${button}`, `
      window.relaykitDemo.client.calls.list().then(calls => calls[0]?.${saying} === ${expected} && "yes")
    `);
  };
  const pressedBothWays = async (button, saying) => {
    const took = await pressing(button, saying, true);
    await pressing(button, saying, false);
    return took;
  };
  // A digit pressed on the keypad. Nothing comes back — whatever is on the other end hears it, not this side
  // — so what is required is that pressing one from the screen does not fail and does not end the call.
  await alice.webContents.executeJavaScript(`
    [...document.querySelectorAll("#dialpad button")].find(one => one.textContent === "5").click();
    true;
  `);
  said.pressedADigit = await waitFor(alice, "the call to carry on after a digit", `
    window.relaykitDemo.client.calls.list().then(calls =>
      calls.some(call => call.state === "connected") && !document.getElementById("status").textContent.startsWith("No se pudo"))
  `);

  said.pressedSilence = await pressedBothWays("call-mute", "isMicrophoneMuted");
  said.pressedHold = await pressedBothWays("call-hold", "isOnHold");
  // Both ways, and the way back is the one that matters: putting the camera away stops the track and removes
  // it, so bringing it back means agreeing a new one with the other side.
  if (video) said.pressedCamera = await pressedBothWays("call-camera", "isCameraMuted");
  // Showing the screen is a second thing to send, not a swap of the camera. Believing the side that is
  // sharing proves nothing, so what is required is that the other side ends up with a screen to show, live,
  // alongside whatever it already had.
  await pressing("call-screen", "isSharingScreen", true);
  said.bobSawTheScreen = await waitFor(bob, "bob to be given the shared screen", `
    window.relaykitDemo.client.calls.list().then(calls => {
      const screen = calls[0]?.remoteScreen;
      const live = screen ? screen.getVideoTracks().filter(one => one.readyState === "live").length : 0;
      return live > 0 && { live, andStillTheirCamera: !!calls[0]?.remoteMedia };
    })
  `);
  // Received is not shown. A screen that arrives and is not drawn is a screen nobody shared, as far as
  // whoever is looking at it is concerned.
  said.screenOnBobsScreen = await waitFor(bob, "the shared screen to be drawn on bob's screen", `
    (() => {
      const shown = document.getElementById("call-screen-media");
      if (!shown || shown.hidden) return false;
      const media = shown.srcObject;
      const live = media ? media.getVideoTracks().filter(one => one.readyState === "live").length : 0;
      return live > 0 && { live };
    })()
  `);
  // And whoever is sharing sees what they are sharing, or they are showing a room they cannot see.
  said.screenOnAlicesScreen = await waitFor(alice, "alice to see what she is sharing", `
    (() => {
      const shown = document.getElementById("call-screen-media");
      return !!shown && !shown.hidden && !!shown.srcObject;
    })()
  `);

  said.showedTheScreen = await pressing("call-screen", "isSharingScreen", false);
  // And it goes away when the sharing stops, rather than leaving a frozen picture on the screen.
  await waitFor(bob, "the shared screen to go away", `document.getElementById("call-screen-media").hidden`);

  // Silencing has to reach the track. A flag that says silenced while the microphone is still sending is
  // worse than no button at all, and only a real call can tell one from the other.
  if (video) return finishOff(alice, bob, said, kind);

  const track = "getAudioTracks";

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
/** Hanging up, and the other side finding out without being touched. */
async function finishOff(alice, bob, said, kind) {
  await alice.webContents.executeJavaScript(`document.getElementById("hang-up").click(); true;`);
  await waitFor(alice, `alice's ${kind} call panel to go away`, `document.getElementById("call-panel").hidden`);
  await waitFor(bob, `bob's ${kind} call panel to go away`, `document.getElementById("call-panel").hidden`);
  said.hungUpOnBothSides = true;
  detail[kind] = said;
}

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

/**
 * Choosing which microphone and camera to use. An application with a device picker asks this on every change,
 * and what it can offer is whatever the browser says is there, so the picker has to fill itself in.
 */
/**
 * Choosing a microphone and then hearing that choice in the next call. Asking for it and not failing proves
 * nothing: what matters is that the call goes out through the one that was picked.
 */
async function chooseDevicesAndUseThem(alice, bob, conversationId) {
  const picked = await alice.webContents.executeJavaScript(`
    (async () => {
      const picker = document.getElementById("microphone");
      // The last one, so it is not whatever would have been used anyway.
      picker.selectedIndex = picker.options.length - 1;
      picker.dispatchEvent(new Event("change"));
      await new Promise(resolve => setTimeout(resolve, 200));
      return picker.value;
    })()
  `);

  await alice.webContents.executeJavaScript(`document.getElementById("call").click(); true;`);
  await waitFor(bob, "bob's screen to ring for the device check", `!document.getElementById("answer").hidden`);
  await bob.webContents.executeJavaScript(`document.getElementById("answer").click(); true;`);

  const used = await waitFor(alice, "the call to be going out through the microphone that was picked", `
    window.relaykitDemo.client.calls.list().then(calls => {
      const track = calls[0]?.ownMedia?.getAudioTracks()[0];
      return track ? track.getSettings().deviceId ?? "sin identificar" : false;
    })
  `);
  if (used !== picked) {
    throw new Error(`A microphone was picked and another one was used: picked ${picked}, used ${used}`);
  }
  detail.microphoneAsked = picked;
  detail.microphoneUsed = used;

  await alice.webContents.executeJavaScript(`document.getElementById("hang-up").click(); true;`);
  await waitFor(alice, "the device call to be over", `document.getElementById("call-panel").hidden`);
  await waitFor(bob, "bob's device call to be over", `document.getElementById("call-panel").hidden`);
}

async function chooseDevices(page) {
  const microphones = await waitFor(page, "the microphone picker to fill in", `
    document.getElementById("microphone").options.length || false
  `);
  await page.webContents.executeJavaScript(`
    const picker = document.getElementById("microphone");
    picker.selectedIndex = 0;
    picker.dispatchEvent(new Event("change"));
    true;
  `);
  // Nothing comes back to look at: what is required is that asking is not a failure and that nothing on the
  // screen breaks, because this is done while a call may be going on.
  const complained = await page.webContents.executeJavaScript(
    `document.getElementById("status").textContent.startsWith("No se pudo")`);
  if (complained) throw new Error("Choosing a microphone was refused");
  detail.microphonesOffered = microphones;
}

/**
 * Everything hung up and nothing left going on. Each of these stands on its own, and a call left over from
 * the last one is somebody already busy when the next one rings — which reads as a failure of whatever is
 * being checked next rather than of what left it there.
 */
async function leaveNothingGoingOn(pages) {
  for (const page of pages) {
    await page.webContents.executeJavaScript(`
      window.relaykitDemo.client.calls.list()
        .then(calls => Promise.all(calls.map(call => window.relaykitDemo.client.calls.hangUp(call.id))))
        .then(() => true)
    `);
  }
  for (const page of pages) {
    await waitFor(page, "everything to be hung up", `
      window.relaykitDemo.client.calls.list().then(calls => calls.length === 0)
    `);
  }
}

/**
 * Passing a call on, which takes three people and is the only way to know it does anything.
 *
 * The SDK sends the message and hangs up; nothing in it acts on that message when it arrives. So a transfer
 * that is not passed on to whoever draws the screen is one side hanging up and the other simply cut off, and
 * from the side that transferred it looks exactly like it worked.
 */
async function passItOn(alice, bob, address) {
  const carol = await open("carol", address);

  await alice.webContents.executeJavaScript(`document.getElementById("call").click(); true;`);
  await waitFor(bob, "bob's screen to ring before being passed on", `!document.getElementById("answer").hidden`);
  await bob.webContents.executeJavaScript(`document.getElementById("answer").click(); true;`);
  await waitFor(alice, "the call to be answered before passing it on", `
    window.relaykitDemo.client.calls.list().then(calls => calls[0]?.state === "connected")
  `);

  await alice.webContents.executeJavaScript(`
    document.getElementById("transfer-to").value = "@carol:localhost";
    document.getElementById("transfer-form").requestSubmit();
    true;
  `);

  // What has to happen: carol's screen rings, without carol having done anything at all.
  detail.carolWasRung = await waitFor(carol, "carol to be rung by the transfer", `
    !document.getElementById("answer").hidden && document.getElementById("call-state").textContent
  `);
  await carol.webContents.executeJavaScript(`document.getElementById("answer").click(); true;`);
  detail.carolCouldHear = await waitFor(carol, "carol to be playing something", `
    (() => {
      const media = document.getElementById("call-media").srcObject;
      const live = media ? media.getAudioTracks().filter(one => one.readyState === "live").length : 0;
      return live > 0 && { live };
    })()
  `);

  // And the one who passed it on is out of it: that is what transferring means.
  await waitFor(alice, "alice to be out of the call she passed on", `
    window.relaykitDemo.client.calls.list().then(calls => calls.length === 0)
  `);
  detail.aliceLeftTheCall = true;

  await leaveNothingGoingOn([alice, bob, carol]);
  carol.destroy();
}

/**
 * A voice call that becomes a video call without ending, and goes back, which is what anybody on a phone
 * expects: you are talking, you turn the camera on, the other side starts seeing you, you turn it off and
 * carry on talking.
 *
 * The call has to be the same one throughout. Ending it and placing another would ring the other person
 * again, which is not turning a camera on.
 */
async function turnTheCameraOnMidCall(alice, bob) {
  await alice.webContents.executeJavaScript(`document.getElementById("call").click(); true;`);
  await waitFor(bob, "bob's screen to ring before the camera goes on", `!document.getElementById("answer").hidden`);
  await bob.webContents.executeJavaScript(`document.getElementById("answer").click(); true;`);

  // Found rather than taken by position: by now there can be more than one call about, and which comes first
  // is nobody's promise.
  const started = await waitFor(alice, "the voice call to be connected", `
    window.relaykitDemo.client.calls.list()
      .then(calls => calls.find(call => call.state === "connected")?.id ?? false)
  `);
  const asItStands = where => `
    window.relaykitDemo.client.calls.list()
      .then(calls => calls.find(call => call.id === ${JSON.stringify(started)}))
      .then(call => ${where})
  `;

  if (!await alice.webContents.executeJavaScript(asItStands("call?.isVideo === false"))) {
    throw new Error("A call placed without a camera already says it has one");
  }

  // The camera goes on in the middle of it, and the call has to stay the call it was.
  await alice.webContents.executeJavaScript(`
    window.relaykitDemo.client.calls.muteCamera(${JSON.stringify(started)}, false).then(() => true)
  `);
  detail.becameVideo = await waitFor(alice, "the call to become a video one",
    asItStands(`call?.isVideo === true && call.id`));
  if (detail.becameVideo !== started) {
    throw new Error("Turning the camera on ended the call and started another one");
  }

  // And the other side has to actually see it, which is the whole point.
  detail.bobStartedSeeingHer = await waitFor(bob, "bob to start seeing alice", `
    window.relaykitDemo.client.calls.list().then(calls => {
      const media = calls.find(call => call.state === "connected")?.remoteMedia;
      const live = media ? media.getVideoTracks().filter(one => one.readyState === "live").length : 0;
      return live > 0 && { live };
    })
  `);

  // Off again, and still talking: the same call, still connected, still heard.
  await alice.webContents.executeJavaScript(`
    window.relaykitDemo.client.calls.muteCamera(${JSON.stringify(started)}, true).then(() => true)
  `);
  detail.stillTalkingAfterwards = await waitFor(alice, "the call to carry on without the camera", asItStands(`
    (() => {
      if (!call || call.state !== "connected" || call.isCameraMuted !== true) return false;
      const heard = call.remoteMedia ? call.remoteMedia.getAudioTracks().filter(one => one.readyState === "live").length : 0;
      return heard > 0 && { heard };
    })()
  `));

  await alice.webContents.executeJavaScript(`
    window.relaykitDemo.client.calls.hangUp(${JSON.stringify(started)}).then(() => true)
  `);
  await leaveNothingGoingOn([alice, bob]);
}

/**
 * Two calls at once, which is what a phone on a desk does: talking to one person, somebody else rings, the
 * first waits, and moving between them loses neither.
 */
async function twoAtOnce(alice, bob, address) {
  const carol = await open("carol", address);

  await alice.webContents.executeJavaScript(`document.getElementById("call").click(); true;`);
  await waitFor(bob, "bob's screen to ring before carol butts in", `!document.getElementById("answer").hidden`);
  await bob.webContents.executeJavaScript(`document.getElementById("answer").click(); true;`);
  const withBob = await waitFor(alice, "the call with bob to be connected", `
    window.relaykitDemo.client.calls.list().then(calls => calls[0]?.state === "connected" && calls[0].id)
  `);

  // Carol rings while that one is going on.
  await carol.webContents.executeJavaScript(`
    document.getElementById("participant").value = "@alice:localhost";
    document.getElementById("open-form").requestSubmit();
    true;
  `);
  await waitFor(carol, "carol's conversation with alice", `
    window.relaykitDemo.client.conversations.list()
      .then(list => list.some(item => item.isDirect && item.participantIds.includes("@alice:localhost")))
  `);
  await carol.webContents.executeJavaScript(`document.getElementById("call").click(); true;`);

  // Alice's screen has to show it without losing the one she is on.
  detail.carolWaitedHerTurn = await waitFor(alice, "carol to show up as another call", `
    (() => {
      const rows = document.querySelectorAll("#other-calls .other-call");
      return rows.length > 0 && rows[0].textContent;
    })()
  `);
  await alice.webContents.executeJavaScript(`
    document.querySelector("#other-calls .other-call button").click(); true;
  `);

  // Both are going on: the one just taken up is talking, the first is waiting.
  detail.bothAtOnce = await waitFor(alice, "both calls to be going on, one of them waiting", `
    window.relaykitDemo.client.calls.list().then(calls => {
      if (calls.length !== 2) return false;
      const held = calls.filter(call => call.isOnHold);
      const talking = calls.filter(call => !call.isOnHold);
      return held.length === 1 && talking.length === 1
        && { waiting: held[0].id, talking: talking[0].id };
    })
  `);
  if (detail.bothAtOnce.waiting !== withBob) {
    throw new Error("Taking up the new call did not leave the one being talked on waiting");
  }

  // And back to bob, which has to leave carol waiting instead.
  await alice.webContents.executeJavaScript(`
    document.querySelector("#other-calls .other-call button").click(); true;
  `);
  detail.wentBackToTheFirst = await waitFor(alice, "the first call to be the one being talked on again", `
    window.relaykitDemo.client.calls.list().then(calls => {
      const bobs = calls.find(call => call.id === ${JSON.stringify(withBob)});
      return calls.length === 2 && bobs?.isOnHold === false && calls.filter(call => call.isOnHold).length === 1;
    })
  `);

  // Hanging one up leaves the other going: that is the whole point of holding them apart.
  await alice.webContents.executeJavaScript(`document.getElementById("hang-up").click(); true;`);
  detail.theOtherSurvived = await waitFor(alice, "the other call to still be going on", `
    window.relaykitDemo.client.calls.list().then(calls => calls.length === 1 && calls[0].id)
  `);
  await leaveNothingGoingOn([alice, bob, carol]);
  carol.destroy();
}

/**
 * Handing a call to somebody already on the line, which is what transferring a call at work means: bob is
 * talking to alice, alice rings carol to say who is coming, and then the two of them are joined and alice
 * steps out.
 *
 * Different from passing on a name: nobody is rung out of nowhere, because both of them are already talking.
 */
async function handOverProperly(alice, bob, address) {
  const carol = await open("carol", address);

  const answer = async (who, why) => {
    await waitFor(who, `${why}`, `!document.getElementById("answer").hidden`);
    await who.webContents.executeJavaScript(`document.getElementById("answer").click(); true;`);
  };

  await alice.webContents.executeJavaScript(`document.getElementById("call").click(); true;`);
  await answer(bob, "bob to be rung before being handed over");

  // A second call, to the person the first one is going to.
  await alice.webContents.executeJavaScript(`
    document.getElementById("participant").value = "@carol:localhost";
    document.getElementById("open-form").requestSubmit();
    true;
  `);
  await waitFor(alice, "the conversation with carol", `
    window.relaykitDemo.client.conversations.list()
      .then(list => list.some(item => item.isDirect && item.participantIds.includes("@carol:localhost")))
  `);
  await alice.webContents.executeJavaScript(`document.getElementById("call").click(); true;`);
  await answer(carol, "carol to be rung to be told who is coming");

  const both = await waitFor(alice, "alice to be on both calls", `
    window.relaykitDemo.client.calls.list().then(calls =>
      calls.length === 2 && calls.every(call => call.state === "connected") && calls.map(call => call.id))
  `);

  // And the two are joined.
  await alice.webContents.executeJavaScript(`
    window.relaykitDemo.client.calls.joinCalls(${JSON.stringify(both[0])}, ${JSON.stringify(both[1])})
      .then(() => true)
  `);

  // Alice steps out of both, and bob and carol are left with each other.
  detail.aliceSteppedOut = await waitFor(alice, "alice to be out of both calls", `
    window.relaykitDemo.client.calls.list().then(calls => calls.length === 0)
  `);
  // Who bob ends up talking to, asked of the conversation the call is in rather than of who rang: a call
  // left over from before would answer the weaker question just as well.
  detail.bobAndCarolLeftTalking = await waitFor(bob, "bob to end up in a call with carol", `
    window.relaykitDemo.client.calls.list().then(async calls => {
      const conversations = await window.relaykitDemo.client.conversations.list();
      const withCarol = calls.find(call => {
        const room = conversations.find(item => item.id === call.conversationId);
        return room?.participantIds.includes("@carol:localhost");
      });
      return withCarol ? { state: withCarol.state } : false;
    })
  `);

  // Carol answers, because being handed a call still means somebody picking it up, and then the two of them
  // are talking with alice nowhere in it.
  await answer(carol, "carol to be rung by bob after the hand over");
  detail.bobAndCarolConnected = await waitFor(bob, "bob and carol to be talking", `
    window.relaykitDemo.client.calls.list().then(async calls => {
      const conversations = await window.relaykitDemo.client.conversations.list();
      const withCarol = calls.find(call => {
        const room = conversations.find(item => item.id === call.conversationId);
        return room?.participantIds.includes("@carol:localhost");
      });
      if (withCarol?.state !== "connected") return false;
      const heard = withCarol.remoteMedia
        ? withCarol.remoteMedia.getAudioTracks().filter(one => one.readyState === "live").length
        : 0;
      return heard > 0 && { heard };
    })
  `);

  await leaveNothingGoingOn([alice, bob, carol]);
  carol.destroy();
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
  // Asking to join and being in are not the same moment, and ringing somebody who is still on their way in
  // is a call that arrives before there is anybody there to hear it.
  detail.bobJoined = await waitFor(bob, "bob to really be in the conversation", `
    window.relaykitDemo.client.conversations.list().then(list =>
      list.find(item => item.id === ${JSON.stringify(conversationId)})?.membership === "join")
  `);

  await ring(alice, bob, { video: false });
  await ring(alice, bob, { video: true });
  await refuse(alice, bob);
  await chooseDevices(alice);
  await chooseDevicesAndUseThem(alice, bob, conversationId);
  await passItOn(alice, bob, address);
  await turnTheCameraOnMidCall(alice, bob);
  await twoAtOnce(alice, bob, address);
  await handOverProperly(alice, bob, address);

  server.close();
  report(true, "two browsers rang each other by voice and by video, answered and hung up");
}

app.whenReady().then(() => run().catch(error => report(false, error.message)));
