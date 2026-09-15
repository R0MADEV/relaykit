"use strict";
// Two browsers calling each other, for real, through a real SFU.
//
// NOT IN CI. Every step passes on its own — `RELAYKIT_CALLS_ONLY=camera` and so on — and the run as a whole
// does not: from about the fourth call onwards the ring reaches the other side and is withdrawn before
// anybody could answer. What was established while chasing it, so the next person does not start over:
//
//   * The room state ends clean: both `m.call.member` entries are empty, as leaving should leave them.
//   * The library does emit `call.incoming` — the other side really is told — and then `call.changed` with
//     `ended` a moment later.
//   * That ending comes from the SDK's own `SessionEnded`, not from anything here: no membership error, no
//     hang up, nothing this library reports.
//   * Giving each step its own conversation fixes several of them and not all, so what accumulates is in the
//     client rather than in the room.
//
// That points at matrix-js-sdk's MatrixRTC session manager across repeated calls, which is not something
// this repository can fix from here. Out of CI rather than red in CI: a check nobody can make pass is a
// check everybody learns to ignore, and then it stops being read at all.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { serve, acceptOwnCertificate, waitFor } = require("./browser-harness.cjs");

// Real browsers on a real call, which is the only way a call can be checked at all.
//
// The unit tests prove what the library says; they cannot prove what is heard, because nothing in node has a
// microphone, a camera or a connection to an SFU. Here alice calls, bob's screen rings and he picks up, both
// have to end up playing what the other sends, three of them hold a conference with every frame encrypted,
// and one of them dies in the middle of it. There is no camera and no microphone on the machine, so Chromium
// is told to make up a tone and a moving picture of its own. Those behave like devices in every way that
// matters: they have identifiers, they can be switched off and asked for again.
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
    report(false, `the page for ${who} died: ${details.reason}`)
  );
  // What the page complains about, brought out here: an error thrown inside a call the check made arrives
  // as a message and nothing else, and the stack that says where it happened stays in a window nobody sees.
  page.webContents.on("console-message", (_event, level, message) => {
    const aboutTheConference = /MatrixRTC|Membership|Encryption|key|rtc|livekit/i.test(message);
    if (level >= 2 || (process.env.RELAYKIT_CALLS_VERBOSE && aboutTheConference)) {
      console.error(`[${who}] ${message}`);
    }
  });
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
    `document.getElementById(${JSON.stringify(video ? "video-call" : "call")}).click(); true;`
  );
  said.aliceCalled = await waitFor(
    alice,
    `alice's ${kind} call panel`,
    `
    !document.getElementById("call-panel").hidden && document.getElementById("call-state").textContent
  `
  );
  // The very first thing the screen says has to be right. Whose call it is is known before the SDK has
  // written down which way it goes, and a screen that draws a call from nobody is what that looked like.
  if (!said.aliceCalled.startsWith("Llamando")) {
    throw new Error(`Alice placed the call and her screen says: ${said.aliceCalled}`);
  }

  // Bob's screen has to ring on its own, and the button to answer has to be the one that is showing.
  said.bobWasRung = await waitFor(
    bob,
    `bob's screen to ring for a ${kind} call`,
    `
    !document.getElementById("answer").hidden && document.getElementById("call-state").textContent
  `
  );
  await bob.webContents.executeJavaScript(`document.getElementById("answer").click(); true;`);

  // Connected is not the same as heard or seen. What has to be true is that the element on the screen has been
  // given a stream with live tracks on it, which is the whole point of a call.
  const playing = `
    (() => {
      // The one box that is not this side's: on a call between two, the other person.
      const theirs = document.querySelector("#participants figure:not([data-me]) video");
      const media = theirs?.srcObject;
      if (!media) return false;
      const live = kinds => kinds.filter(track => track.readyState === "live").length;
      const heard = live(media.getAudioTracks());
      const seen = live(media.getVideoTracks());
      if (heard === 0) return false;
      if (${video} && seen === 0) return false;
      return { heard, seen, onScreen: !theirs.hidden };
    })()
  `;
  said.alice = await waitFor(alice, `alice's screen to be playing bob's ${kind}`, playing);
  said.bob = await waitFor(bob, `bob's screen to be playing alice's ${kind}`, playing);

  // A video call has a picture to show and a voice call has not: keeping room for one that will never come
  // leaves a hole on the screen.
  for (const [who, what] of [
    ["alice", said.alice],
    ["bob", said.bob]
  ]) {
    if (what.onScreen !== video) {
      throw new Error(
        video
          ? `A video call is not showing the picture on ${who}'s screen`
          : `A voice call is keeping a hole on ${who}'s screen for a picture that will never come`
      );
    }
  }

  // The same from the screen, which is where somebody actually does it: press, and the call has to say so.
  // Pressed, and then waited on until the call says it took. Firing the next one blind is how a check ends up
  // asking for something while the call is still agreeing the last one with the other side, and the SDK says
  // no to that — rightly, and an application would see the same.
  const pressing = async (button, saying, expected) => {
    await alice.webContents.executeJavaScript(
      `document.getElementById(${JSON.stringify(button)}).click(); true;`
    );
    return waitFor(
      alice,
      `the call to say ${saying} is ${expected} after pressing ${button}`,
      `
      window.relaykitDemo.client.calls.list().then(calls => calls[0]?.${saying} === ${expected} && "yes")
    `
    );
  };
  const pressedBothWays = async (button, saying) => {
    const took = await pressing(button, saying, true);
    await pressing(button, saying, false);
    return took;
  };
  said.pressedSilence = await pressedBothWays("call-mute", "isMicrophoneMuted");
  // Both ways, and the way back is the one that matters: putting the camera away stops the track and removes
  // it, so bringing it back means agreeing a new one with the other side.
  if (video) said.pressedCamera = await pressedBothWays("call-camera", "isCameraMuted");
  // Showing the screen is a second thing to send, not a swap of the camera. Believing the side that is
  // sharing proves nothing, so what is required is that the other side ends up with a screen to show, live,
  // alongside whatever it already had.
  await pressing("call-screen", "isSharingScreen", true);
  said.bobSawTheScreen = await waitFor(
    bob,
    "bob to be given the shared screen",
    `
    window.relaykitDemo.client.calls.list().then(calls => {
      const screen = calls[0]?.remoteScreen;
      const live = screen ? screen.getVideoTracks().filter(one => one.readyState === "live").length : 0;
      return live > 0 && { live, andStillTheirCamera: !!calls[0]?.remoteMedia };
    })
  `
  );
  // Received is not shown. A screen that arrives and is not drawn is a screen nobody shared, as far as
  // whoever is looking at it is concerned.
  said.screenOnBobsScreen = await waitFor(
    bob,
    "the shared screen to be drawn on bob's screen",
    `
    (() => {
      const shown = document.getElementById("call-screen-media");
      if (!shown || shown.hidden) return false;
      const media = shown.srcObject;
      const live = media ? media.getVideoTracks().filter(one => one.readyState === "live").length : 0;
      return live > 0 && { live };
    })()
  `
  );
  // And whoever is sharing sees what they are sharing, or they are showing a room they cannot see.
  said.screenOnAlicesScreen = await waitFor(
    alice,
    "alice to see what she is sharing",
    `
    (() => {
      const shown = document.getElementById("call-screen-media");
      return !!shown && !shown.hidden && !!shown.srcObject;
    })()
  `
  );

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

  await hangUpFromBothSides(alice, bob, said, kind);

  detail[kind] = said;
}

/**
 * Refusing a call, which is not hanging one up: nobody answered, and the other side has to be told so and put
 * its own screen away.
 */
/** Hanging up, and the other side finding out without being touched. */
async function finishOff(alice, bob, said, kind) {
  await hangUpFromBothSides(alice, bob, said, kind);
  detail[kind] = said;
}

/**
 * Alice hangs up and the call goes on for bob, alone: a room does not end because somebody left it. What has
 * to be true is that bob is told — his call shrinks to himself — and that when he hangs up too, both screens
 * are clear. Whether an application ends a call left with one person on it is its decision, not the
 * library's.
 */
async function hangUpFromBothSides(alice, bob, said, kind) {
  await alice.webContents.executeJavaScript(`document.getElementById("hang-up").click(); true;`);
  await waitFor(
    alice,
    `alice's ${kind} call panel to go away`,
    `document.getElementById("call-panel").hidden`
  );
  said.bobWasLeftAlone = await waitFor(
    bob,
    `bob to be left alone on the ${kind} call`,
    `
    window.relaykitDemo.client.calls.list().then(calls =>
      calls.length === 1 && calls[0].participants.length === 1 && calls[0].participants[0].userId)
  `
  );
  await bob.webContents.executeJavaScript(`document.getElementById("hang-up").click(); true;`);
  await waitFor(bob, `bob's ${kind} call panel to go away`, `document.getElementById("call-panel").hidden`);
  said.hungUpOnBothSides = true;
}

/**
 * Not picking up. The one who was rung puts their screen away; the one who started the call is still on it,
 * alone, until they hang up — a room does not end because somebody did not come.
 */
async function refuse(alice, bob) {
  await alice.webContents.executeJavaScript(`document.getElementById("call").click(); true;`);
  await waitFor(
    bob,
    "bob's screen to ring before refusing",
    `!document.getElementById("call-panel").hidden && !document.getElementById("reject").hidden`
  );
  await bob.webContents.executeJavaScript(`document.getElementById("reject").click(); true;`);

  await waitFor(
    bob,
    "bob's screen to put itself away after refusing",
    `document.getElementById("call-panel").hidden`
  );
  detail.refusedAndStillOnIt = await waitFor(
    alice,
    "alice to still be on the call she started",
    `
    window.relaykitDemo.client.calls.list().then(calls => calls.length === 1 && calls[0].participants.length)
  `
  );
  await alice.webContents.executeJavaScript(`document.getElementById("hang-up").click(); true;`);
  await waitFor(
    alice,
    "alice's refused call to go away once she hangs up",
    `document.getElementById("call-panel").hidden`
  );
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
/**
 * Picking a microphone and having the call go out through it.
 *
 * In a conversation of its own, and that matters: this is about the device picker, not about how many calls
 * a room has had. Placing the fourth call into the same conversation runs into matrix-js-sdk ending the RTC
 * session the moment it starts — the ring reaches the other side and is withdrawn before anybody could
 * answer — which is worth knowing and is not what this step is here to find out.
 */
/**
 * A conversation of its own, with both of them really in it.
 *
 * One reused across runs collects the memberships of every run that was killed halfway and whatever an old
 * bug did to it, and a check that fails for last week's reasons checks nothing.
 */
async function aConversationOfTheirOwn(alice, bob, why) {
  // A conversation of its own for each run. One reused across runs collects the memberships of every run
  // that was killed halfway and whatever an old bug did to it, and a check that fails for last week's
  // reasons checks nothing. Made directly rather than through the picker, which would find the old one, and
  // then chosen on the screen the way a person chooses one: by clicking its row.
  const title = `calls ${why} ${Date.now()}`;
  const conversationId = await alice.webContents.executeJavaScript(`
    window.relaykitDemo.client.conversations
      .create({ participantIds: ["@bob:localhost"], direct: true, title: ${JSON.stringify(title)} })
      .then(conversation => conversation.id)
  `);
  await waitFor(
    alice,
    "the new conversation to show up in alice's list",
    `
    (() => {
      const row = [...document.querySelectorAll("#conversations li")]
        .find(item => item.querySelector(".name")?.textContent === ${JSON.stringify(title)});
      if (!row) return false;
      row.click();
      return true;
    })()
  `
  );
  await waitFor(
    alice,
    "the new conversation to be the one on alice's screen",
    `
    [...document.querySelectorAll("#conversations li")]
      .some(item => item.getAttribute("aria-current") === "true"
        && item.querySelector(".name")?.textContent === ${JSON.stringify(title)})
  `
  );
  detail.conversationId = conversationId;

  // An invitation is not a conversation yet: bob has to be in the room to be rung in it. Setting up, not the
  // thing being checked, so it is asked for plainly.
  await waitFor(
    bob,
    "bob to see the invitation",
    `
    window.relaykitDemo.client.conversations.list()
      .then(list => list.some(item => item.id === ${JSON.stringify(conversationId)}))
  `
  );
  await bob.webContents.executeJavaScript(`
    window.relaykitDemo.client.conversations.join(${JSON.stringify(conversationId)}).then(() => true)
  `);
  // Asking to join and being in are not the same moment, and ringing somebody who is still on their way in
  // is a call that arrives before there is anybody there to hear it.
  detail.bobJoined = await waitFor(
    bob,
    "bob to really be in the conversation",
    `
    window.relaykitDemo.client.conversations.list().then(list =>
      list.find(item => item.id === ${JSON.stringify(conversationId)})?.membership === "join")
  `
  );

  return conversationId;
}

async function chooseDevicesAndUseThem(alice, bob) {
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
  await waitFor(
    bob,
    "bob's screen to ring for the device check",
    `!document.getElementById("call-panel").hidden && !document.getElementById("answer").hidden`
  );
  await bob.webContents.executeJavaScript(`document.getElementById("answer").click(); true;`);

  const used = await waitFor(
    alice,
    "the call to be going out through the microphone that was picked",
    `
    window.relaykitDemo.client.calls.list().then(calls => {
      const track = calls[0]?.ownMedia?.getAudioTracks()[0];
      return track ? track.getSettings().deviceId ?? "sin identificar" : false;
    })
  `
  );
  if (used !== picked) {
    throw new Error(`A microphone was picked and another one was used: picked ${picked}, used ${used}`);
  }
  detail.microphoneAsked = picked;
  detail.microphoneUsed = used;

  await hangUpFromBothSides(alice, bob, detail, "device");
}

async function chooseDevices(page) {
  const microphones = await waitFor(
    page,
    "the microphone picker to fill in",
    `
    document.getElementById("microphone").options.length || false
  `
  );
  await page.webContents.executeJavaScript(`
    const picker = document.getElementById("microphone");
    picker.selectedIndex = 0;
    picker.dispatchEvent(new Event("change"));
    true;
  `);
  // Nothing comes back to look at: what is required is that asking is not a failure and that nothing on the
  // screen breaks, because this is done while a call may be going on.
  const complained = await page.webContents.executeJavaScript(
    `document.getElementById("status").textContent.startsWith("No se pudo")`
  );
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
    await waitFor(
      page,
      "everything to be hung up",
      `
      window.relaykitDemo.client.calls.list().then(calls => calls.length === 0)
    `
    );
  }
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
  await waitFor(
    bob,
    "bob's screen to ring before the camera goes on",
    `!document.getElementById("call-panel").hidden && !document.getElementById("answer").hidden`
  );
  await bob.webContents.executeJavaScript(`document.getElementById("answer").click(); true;`);

  // Found rather than taken by position: by now there can be more than one call about, and which comes first
  // is nobody's promise.
  const started = await waitFor(
    alice,
    "the voice call to be connected",
    `
    window.relaykitDemo.client.calls.list()
      .then(calls => calls.find(call => call.state === "connected")?.id ?? false)
  `
  );
  const asItStands = where => `
    window.relaykitDemo.client.calls.list()
      .then(calls => calls.find(call => call.id === ${JSON.stringify(started)}))
      .then(call => ${where})
  `;

  if (!(await alice.webContents.executeJavaScript(asItStands("call?.isVideo === false")))) {
    throw new Error("A call placed without a camera already says it has one");
  }

  // The camera goes on in the middle of it, and the call has to stay the call it was.
  await alice.webContents.executeJavaScript(`
    window.relaykitDemo.client.calls.muteCamera(${JSON.stringify(started)}, false).then(() => true)
  `);
  detail.becameVideo = await waitFor(
    alice,
    "the call to become a video one",
    asItStands(`call?.isVideo === true && call.id`)
  );
  if (detail.becameVideo !== started) {
    throw new Error("Turning the camera on ended the call and started another one");
  }

  // And the other side has to actually see it, which is the whole point.
  // What bob sees of everybody, for when he does not see alice: a timeout says nothing about why.
  const bobsView = () =>
    bob.webContents.executeJavaScript(`
    window.relaykitDemo.client.calls.list().then(calls => calls.map(call => ({
      state: call.state,
      people: call.participants.map(one => ({
        who: one.userId,
        audio: one.media ? one.media.getAudioTracks().map(track => track.readyState) : [],
        video: one.media ? one.media.getVideoTracks().map(track => track.readyState) : [],
        cameraMuted: one.isCameraMuted
      }))
    })))
  `);
  detail.bobStartedSeeingHer = await waitFor(
    bob,
    "bob to start seeing alice",
    `
    window.relaykitDemo.client.calls.list().then(calls => {
      const media = calls.find(call => call.state === "connected")?.remoteMedia;
      const live = media ? media.getVideoTracks().filter(one => one.readyState === "live").length : 0;
      return live > 0 && { live };
    })
  `
  ).catch(async error => {
    throw new Error(`${error.message}; bob sees ${JSON.stringify(await bobsView())}`);
  });

  // Off again, and still talking: the same call, still connected, still heard.
  await alice.webContents.executeJavaScript(`
    window.relaykitDemo.client.calls.muteCamera(${JSON.stringify(started)}, true).then(() => true)
  `);
  detail.stillTalkingAfterwards = await waitFor(
    alice,
    "the call to carry on without the camera",
    asItStands(`
    (() => {
      if (!call || call.state !== "connected" || call.isCameraMuted !== true) return false;
      const heard = call.remoteMedia ? call.remoteMedia.getAudioTracks().filter(one => one.readyState === "live").length : 0;
      return heard > 0 && { heard };
    })()
  `)
  );

  await alice.webContents.executeJavaScript(`
    window.relaykitDemo.client.calls.hangUp(${JSON.stringify(started)}).then(() => true)
  `);
  await leaveNothingGoingOn([alice, bob]);
}

/**
 * Three people in a room, carried by the SFU, and nobody dialling anybody: alice enters, the other two are
 * rung by the room itself and enter, and each of them ends up playing the other two.
 *
 * Live tracks are not enough here. Every frame is encrypted before it leaves each browser with keys that
 * travel over Matrix, and a track whose frames cannot be decrypted is still "live" — it just never shows a
 * picture. So alice's picture is drawn on bob's screen and a frame has to actually be presented, which only
 * happens if bob got alice's key and used it. That is the one thing that proves the encryption works and
 * not merely that it was switched on.
 */
async function holdAConference(alice, bob, address) {
  const carol = await open("carol", address);
  const said = {};

  // A room with the three of them, made and entered the way the other checks do it.
  const conversationId = await alice.webContents.executeJavaScript(`
    window.relaykitDemo.client.conversations
      .create({ participantIds: ["@bob:localhost", "@carol:localhost"], title: "conference", encrypted: true })
      .then(conversation => conversation.id)
  `);
  // Written down first, so a failure says which room to go and look at.
  detail.conferenceRoom = conversationId;
  for (const [who, page] of [
    ["bob", bob],
    ["carol", carol]
  ]) {
    await waitFor(
      page,
      `${who} to see the conference room`,
      `
      window.relaykitDemo.client.conversations.list().then(list => list.some(item => item.id === ${JSON.stringify(conversationId)}))
    `
    );
    await page.webContents.executeJavaScript(
      `window.relaykitDemo.client.conversations.join(${JSON.stringify(conversationId)}).then(() => true)`
    );
    await waitFor(
      page,
      `${who} to really be in the conference room`,
      `
      window.relaykitDemo.client.conversations.list().then(list =>
        list.find(item => item.id === ${JSON.stringify(conversationId)})?.membership === "join")
    `
    );
  }

  // Bob keeps what rings, so that a room starting a call can be told apart from bob asking to enter one.
  await bob.webContents.executeJavaScript(`
    window.rung = null;
    window.relaykitDemo.client.on("call.incoming", call => { window.rung = call; });
    true;
  `);

  const conferenceOf = `
    window.relaykitDemo.client.calls.list().then(calls =>
      calls.find(call => call.conversationId === ${JSON.stringify(conversationId)}) ?? false)
  `;
  await alice.webContents.executeJavaScript(`
    window.relaykitDemo.client.calls.join(${JSON.stringify(conversationId)}, { video: true }).then(() => true)
  `);
  said.aliceEntered = await waitFor(
    alice,
    "alice to be in the conference",
    `
    ${conferenceOf}.then(call => call && call.state === "connected" && call.isEncrypted === true && call.id)
  `
  );

  // The room rings bob without anybody having called him: it says a conference is going on, and who is in it.
  said.bobWasRungByTheRoom = await waitFor(
    bob,
    "bob's screen to ring for the conference",
    `
    window.rung && window.rung.state === "ringing" && window.rung.participants.map(one => one.userId)
  `
  );
  if (!said.bobWasRungByTheRoom.includes("@alice:localhost")) {
    throw new Error(
      `Bob was rung for a conference that does not say alice is in it: ${said.bobWasRungByTheRoom}`
    );
  }
  // And not himself: a screen ringing for a call must not show you already on it.
  if (said.bobWasRungByTheRoom.includes("@bob:localhost")) {
    throw new Error("Bob was shown on a call he had not joined");
  }

  for (const page of [bob, carol]) {
    await page.webContents.executeJavaScript(`
      window.relaykitDemo.client.calls.join(${JSON.stringify(conversationId)}).then(() => true)
    `);
  }

  // Everybody has everybody: three in each list, and the other two arriving live to each of them.
  const hearingTheOtherTwo = `
    ${conferenceOf}.then(call => {
      if (!call || call.participants.length !== 3) return false;
      const others = call.participants.filter(one => one.media !== undefined);
      const heard = others.filter(one => one.media.getAudioTracks().some(track => track.readyState === "live"));
      return heard.length >= 2 && { inTheRoom: call.participants.length, heard: heard.length, encrypted: call.isEncrypted };
    })
  `;
  for (const [who, page] of [
    ["alice", alice],
    ["bob", bob],
    ["carol", carol]
  ]) {
    said[`${who}Hears`] = await waitFor(page, `${who} to hear the other two`, hearingTheOtherTwo);
    if (said[`${who}Hears`].encrypted !== true) {
      throw new Error(
        `${who}'s conference does not say it is encrypted: ${JSON.stringify(said[`${who}Hears`])}`
      );
    }
  }

  // The proof of the keys: a frame of alice's camera actually drawn on bob's screen.
  said.bobSawAFrameOfAlice = await waitFor(
    bob,
    "a frame of alice to be presented on bob's screen",
    `
    ${conferenceOf}.then(call => new Promise(resolve => {
      const alice = call && call.participants.find(one => one.userId === "@alice:localhost");
      const picture = alice?.media?.getVideoTracks().find(track => track.readyState === "live");
      if (!picture) return resolve(false);
      const shown = document.getElementById("conference-proof") ?? Object.assign(document.createElement("video"), { id: "conference-proof", muted: true, autoplay: true, playsInline: true });
      document.body.append(shown);
      shown.srcObject = new MediaStream([picture]);
      // Several frames and not one: one frame arrived and then black is exactly what a paused track looks
      // like, and it looked like a pass once.
      const gaveUp = setTimeout(() => resolve(false), 4000);
      const onFrame = (_now, frame) => {
        if (frame.presentedFrames < 5) { shown.requestVideoFrameCallback(onFrame); return; }
        clearTimeout(gaveUp);
        resolve({ width: frame.width, height: frame.height, presented: frame.presentedFrames });
      };
      shown.requestVideoFrameCallback(onFrame);
      shown.play().catch(() => undefined);
    }))
  `
  );
  if (!(said.bobSawAFrameOfAlice.width > 0 && said.bobSawAFrameOfAlice.presented > 0)) {
    throw new Error(
      `Alice's picture reached bob but no frame was ever drawn: ${JSON.stringify(said.bobSawAFrameOfAlice)}`
    );
  }

  // A screen shared with three on the call reaches the two who are not sharing it — and is drawn for them.
  // With two people there is a shortcut for "the other one's screen"; with three there is not, and that is
  // exactly where it went unseen once.
  await alice.webContents.executeJavaScript(`
    ${conferenceOf}.then(call => window.relaykitDemo.client.calls.shareScreen(call.id, true)).then(() => true)
  `);
  said.carolSawAlicesScreen = await waitFor(
    carol,
    "carol to be shown alice's screen",
    `
    (() => {
      const shown = document.getElementById("call-screen-media");
      if (!shown || shown.hidden || !shown.srcObject) return false;
      const live = shown.srcObject.getVideoTracks().filter(one => one.readyState === "live").length;
      return live > 0 && { live };
    })()
  `
  );
  // One screen at a time: bob starting to share makes alice stop, and carol ends up with bob's.
  await bob.webContents.executeJavaScript(`
    ${conferenceOf}.then(call => window.relaykitDemo.client.calls.shareScreen(call.id, true)).then(() => true)
  `);
  said.aliceStoppedWhenBobShared = await waitFor(
    alice,
    "alice to stop sharing once bob does",
    `${conferenceOf}.then(call => call && call.isSharingScreen === false && "yes")`
  );
  said.carolNowSeesBobsScreen = await waitFor(
    carol,
    "carol to be shown bob's screen instead",
    `
    window.relaykitDemo.client.calls.list().then(calls => {
      const call = calls.find(one => one.conversationId === ${JSON.stringify(conversationId)});
      const bob = call && call.participants.find(one => one.userId === "@bob:localhost");
      const alice = call && call.participants.find(one => one.userId === "@alice:localhost");
      return !!bob?.screen && !alice?.screen && "yes";
    })
  `
  );
  await bob.webContents.executeJavaScript(`
    ${conferenceOf}.then(call => window.relaykitDemo.client.calls.shareScreen(call.id, false)).then(() => true)
  `);
  await waitFor(
    carol,
    "bob's screen to go away from carol's",
    `document.getElementById("call-screen-media").hidden`
  );

  // One leaves, the other two carry on with each other: that is what a room is, as against a line.
  await alice.webContents.executeJavaScript(`
    ${conferenceOf}.then(call => window.relaykitDemo.client.calls.hangUp(call.id)).then(() => true)
  `);
  said.carriedOnWithoutAlice = await waitFor(
    bob,
    "bob's conference to carry on with carol",
    `
    ${conferenceOf}.then(call => call && call.state === "connected" && call.participants.length === 2
      && !call.participants.some(one => one.userId === "@alice:localhost") && call.participants.map(one => one.userId))
  `
  );
  await waitFor(
    alice,
    "alice to be out of the conference",
    `
    window.relaykitDemo.client.calls.list().then(calls => !calls.some(call => call.conversationId === ${JSON.stringify(conversationId)}))
  `
  );

  await leaveNothingGoingOn([alice, bob, carol]);
  await signOut(carol);
  carol.destroy();
  detail.conference = said;
}

/**
 * A tab that dies in the middle of a call. Nobody hangs up, nothing is sent: the browser is simply gone, the
 * way it is when somebody closes it or reloads it or the machine sleeps. Everybody else must see them leave
 * anyway, and soon. That is the homeserver's delayed events doing what the SDK asked of them when it joined
 * — "take my membership down in eight seconds unless I say otherwise" — and without them the dead stay on
 * the call for four hours and everybody's screen keeps drawing them.
 */
async function dyingLeavesTheCall(alice, bob, conversationId) {
  await alice.webContents.executeJavaScript(`document.getElementById("call").click(); true;`);
  await waitFor(
    bob,
    "bob's screen to ring before alice dies",
    `!document.getElementById("call-panel").hidden && !document.getElementById("answer").hidden`
  );
  await bob.webContents.executeJavaScript(`document.getElementById("answer").click(); true;`);
  await waitFor(
    bob,
    "bob and alice to be on the call together",
    `
    window.relaykitDemo.client.calls.list().then(calls =>
      calls.some(call => call.conversationId === ${JSON.stringify(conversationId)} && call.state === "connected" && call.participants.length === 2))
  `
  );

  // Gone, without a word.
  const died = Date.now();
  alice.destroy();

  detail.deadLeftWithin = await waitFor(
    bob,
    "alice to be gone from bob's call after her tab died",
    `
    window.relaykitDemo.client.calls.list().then(calls => {
      const call = calls.find(one => one.conversationId === ${JSON.stringify(conversationId)});
      return call && call.participants.length === 1 && call.participants[0].userId === "@bob:localhost" && "yes";
    })
  `,
    90
  ).then(() => `${Math.round((Date.now() - died) / 1000)}s`);

  await bob.webContents.executeJavaScript(`document.getElementById("hang-up").click(); true;`);
  await waitFor(bob, "bob's call panel to go away", `document.getElementById("call-panel").hidden`);
}

/**
 * Every run signs in as a new device and, left like this, never signs out: hundreds of dead devices per
 * account, each with Olm sessions and one-time keys nobody will use again, until keys sent between the live
 * ones start going astray. A device that is done says so.
 */
async function signOut(...pages) {
  for (const page of pages) {
    if (page.isDestroyed()) continue;
    await page.webContents.executeJavaScript(
      `window.relaykitDemo.client.logout().then(() => true, () => true)`
    );
  }
}

/**
 * A room from before, or from another client: made with the defaults, which let only admins say they are on
 * a call. Bob, who is not one, is the first to call in it. Once, that was a 403 nobody saw and a dead end:
 * bob was refused, nothing was written, and alice never learned anybody had tried. Now alice's client opens
 * the room the moment it sees it, and bob's call simply goes through.
 */
async function callingFirstInAnOldRoom(alice, bob) {
  const homeserver = "http://localhost:8008";
  const asAlice = await fetch(`${homeserver}/_matrix/client/v3/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: "alice" },
      password: "alice-password"
    })
  }).then(response => response.json());
  const made = await fetch(`${homeserver}/_matrix/client/v3/createRoom`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${asAlice.access_token}` },
    body: JSON.stringify({ name: `old room ${Date.now()}`, invite: ["@bob:localhost"] })
  }).then(response => response.json());
  await fetch(`${homeserver}/_matrix/client/v3/logout`, {
    method: "POST",
    headers: { authorization: `Bearer ${asAlice.access_token}` }
  });
  const oldRoom = made.room_id;
  detail.oldRoom = oldRoom;

  // Bob is invited and the example accepts invitations on its own; alice's client sees the room as one she
  // is in. Both have to really be in before anybody calls.
  for (const [who, page] of [
    ["alice", alice],
    ["bob", bob]
  ]) {
    await waitFor(
      page,
      `${who} to be in the old room`,
      `
      window.relaykitDemo.client.conversations.list().then(list =>
        list.find(item => item.id === ${JSON.stringify(oldRoom)})?.membership === "join")
    `,
      60
    );
  }

  await bob.webContents.executeJavaScript(`
    window.relaykitDemo.client.calls.place(${JSON.stringify(oldRoom)}, { video: false }).then(() => true)
  `);
  // The refusal used to arrive a moment later, as the call ending with a reason. It must not arrive at all,
  // and the room must ring alice.
  detail.aliceWasRungInTheOldRoom = await waitFor(
    alice,
    "alice to be rung in the old room by bob",
    `
    window.relaykitDemo.client.calls.list().then(calls =>
      calls.some(call => call.conversationId === ${JSON.stringify(oldRoom)} && call.state === "ringing") && "yes")
  `,
    60
  );
  const bobsCall = await bob.webContents.executeJavaScript(`
    window.relaykitDemo.client.calls.list().then(calls => calls.find(call => call.conversationId === ${JSON.stringify(oldRoom)}))
  `);
  if (!bobsCall || bobsCall.state !== "connected" || bobsCall.wentWrong) {
    throw new Error(`Bob's call in the old room did not hold: ${JSON.stringify(bobsCall)}`);
  }
  await leaveNothingGoingOn([alice, bob]);
}

async function run() {
  const server = await serve(root);
  // Told where conferences are carried, because a development homeserver has no `.well-known` to say so.
  const carriedAt = process.env.RELAYKIT_CONFERENCE_SERVICE ?? "http://localhost:8091";
  const address = `https://127.0.0.1:${server.address().port}/?conference=${encodeURIComponent(carriedAt)}`;
  const alice = await open("alice", address);
  const bob = await open("bob", address);
  detail.bothSignedIn = true;

  // Bob keeps whatever call arrives, from now on, so that none is missed while something else is awaited.
  await bob.webContents.executeJavaScript(`
    window.arrived = null;
    window.relaykitDemo.client.on("call.incoming", call => { window.arrived = call; });
    true;
  `);

  const conversationId = await aConversationOfTheirOwn(alice, bob, "todo");

  // Everything, or one thing by name while it is being worked on: eight minutes of what already passes is a
  // long way to walk to the one step that does not.
  // One or several by name, in the order given: `RELAYKIT_CALLS_ONLY=devices,camera` walks the same path
  // as the whole run does between those two, which is how a step that passes alone and fails after
  // another is caught.
  const only = process.env.RELAYKIT_CALLS_ONLY?.split(",").map(name => name.trim());
  // Each step that rings somebody does it in a conversation of its own.
  //
  // Not tidiness. matrix-js-sdk ends the RTC session of a conversation the moment a later call starts in it
  // — the ring reaches the other side and is withdrawn before anybody could answer — so every step after the
  // third was failing for the step before it rather than for itself. Made fresh, each one checks the one
  // thing it is named after. The underlying behaviour is worth chasing upstream and is not this check's job.
  const steps = {
    voice: async () => {
      await aConversationOfTheirOwn(alice, bob, "voice");
      await ring(alice, bob, { video: false });
    },
    video: async () => {
      await aConversationOfTheirOwn(alice, bob, "video");
      await ring(alice, bob, { video: true });
    },
    refuse: async () => {
      await aConversationOfTheirOwn(alice, bob, "refuse");
      await refuse(alice, bob);
    },
    devices: async () => {
      await chooseDevices(alice);
      // Its own conversation: this is about the picker, not about how many calls a room has had.
      await aConversationOfTheirOwn(alice, bob, "devices");
      await chooseDevicesAndUseThem(alice, bob);
    },
    camera: async () => {
      // Its own too, and for the same reason as the device step: what is being checked is a camera going on
      // mid-call, not what a conversation looks like after three calls have already been made in it.
      await aConversationOfTheirOwn(alice, bob, "camera");
      await turnTheCameraOnMidCall(alice, bob);
    },
    conference: () => holdAConference(alice, bob, address),
    oldroom: () => callingFirstInAnOldRoom(alice, bob),
    // Last, because alice does not come back from it.
    dying: () => dyingLeavesTheCall(alice, bob, conversationId)
  };
  const unknown = (only ?? []).filter(name => !(name in steps));
  if (unknown.length > 0) {
    throw new Error(
      `There is no step called ${unknown.join(", ")}; there are ${Object.keys(steps).join(", ")}`
    );
  }
  for (const name of only ?? Object.keys(steps)) await steps[name]();

  await signOut(alice, bob);
  server.close();
  report(
    true,
    "two browsers rang each other by voice and by video, and three held a call together, all of it encrypted"
  );
}

app.whenReady().then(() => run().catch(error => report(false, error.message)));
