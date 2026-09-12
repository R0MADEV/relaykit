import { MessagingClient } from "@relaykit/core";
import { InMemoryStorage } from "@relaykit/in-memory";
import { MatrixJsAdapter } from "@relaykit/matrix-js";

// Asking the homeserver for a window over the conversations instead of all of them, which is what makes an
// account with thousands of them open at once.
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const alice = { username: process.env.MATRIX_USER_A ?? "alice", password: process.env.MATRIX_PASSWORD_A ?? "alice-password" };

process.on("unhandledRejection", error => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("MatrixClient has been stopped") || message.includes("M_UNRECOGNIZED")) return;
  console.error(error);
  process.exit(1);
});

async function timed(work) {
  const started = performance.now();
  const result = await work();
  return { result, took: Math.round(performance.now() - started) };
}

async function main() {
  const windowed = new MessagingClient({
    adapter: new MatrixJsAdapter({ conversationWindow: 40 }),
    storage: new InMemoryStorage()
  });
  await windowed.login({ ...alice, homeserver, deviceName: "RelayKit window smoke" });

  const catchingUp = await timed(() => windowed.start());

  // The point is what the homeserver was asked for, not what is shown afterwards: asking with no limit has to
  // come back with the window, not with the whole account. Otherwise this is a full sync wearing a hat.
  const everythingKnown = await windowed.conversations.list();
  if (everythingKnown.length > 60) {
    throw new Error(`The window was asked for forty and the client knows ${everythingKnown.length} conversations`);
  }

  const first = await windowed.conversations.list({ limit: 40 });
  if (first.length !== 40) {
    throw new Error(`The window should hold forty conversations and holds ${first.length}`);
  }
  if (first.some(item => item.id === undefined)) throw new Error("A conversation with no identifier came back");

  // Scrolling on: asking for more widens the window rather than starting again.
  const more = await windowed.conversations.list({ limit: 80 });
  if (more.length !== 80) {
    throw new Error(`Asking for eighty gave ${more.length}`);
  }
  // Not the same order: a window fills in as it goes, and a conversation whose last message has just arrived
  // really is more recent than it looked a second ago. What must not happen is losing any of them.
  const stillThere = new Set(more.map(item => item.id));
  const lost = first.filter(item => !stillThere.has(item.id));
  if (lost.length > 0) {
    throw new Error(`Widening the window lost ${lost.length} conversations that were already on screen`);
  }

  // And a conversation in the window can still be read and talked in.
  const talkable = more.find(item => item.membership === "join");
  if (!talkable) throw new Error("None of the conversations in the window can be talked in");
  await windowed.messages.list(talkable.id);
  const said = `ventana-${Date.now()}`;
  await windowed.messages.send(talkable.id, said);

  // A conversation that fell outside the window: searching finds it, and opening it has to work. Without this
  // a window would only be usable as long as nobody looked past it.
  const everything = await windowed.conversations.list({ limit: 200 });
  // One with something said in it, so reading it can prove more than "an empty list came back".
  // One that can be talked in, because saying something in it is part of what is being proven.
  const farEnoughDown = everything.filter(item => item.lastMessage !== undefined && item.membership === "join");
  const farDown = farEnoughDown.at(-1);
  // A second one, kept aside: saying something in a conversation moves it to the front of everybody's window,
  // so whatever is proven on the first one cannot be proven again on it.
  const neverTouched = farEnoughDown.at(-2);
  if (!farDown || !neverTouched) throw new Error("The account has nothing far enough down to try this");
  const narrow = new MessagingClient({
    adapter: new MatrixJsAdapter({ conversationWindow: 5 }),
    storage: new InMemoryStorage()
  });
  await narrow.login({ ...alice, homeserver, deviceName: "RelayKit window smoke (narrow)" });
  await narrow.start();
  const inTheWindow = await narrow.conversations.list();
  if (inTheWindow.some(item => item.id === farDown.id)) {
    throw new Error("The conversation being tried is inside the window, so this proves nothing");
  }

  const reachedAnyway = await narrow.messages.list(farDown.id, { atLeast: 1 });
  if (reachedAnyway.length === 0) {
    throw new Error("A conversation outside the window came back empty, and it has messages");
  }
  if (!reachedAnyway.some(message => message.body === farDown.lastMessage?.body)) {
    throw new Error("What came back is not what that conversation says");
  }
  // And everything else somebody does with a conversation has to reach past the window too, not only reading.
  const saidFarDown = `fuera-${Date.now()}`;
  const sentFarDown = await narrow.messages.send(farDown.id, saidFarDown);
  if (sentFarDown.status !== "sent") {
    throw new Error(`Saying something outside the window left it as ${sentFarDown.status}`);
  }
  await narrow.messages.markRead(farDown.id, sentFarDown.id);
  await narrow.reactions.add(farDown.id, sentFarDown.id, "👍");
  await narrow.messages.edit(farDown.id, sentFarDown.id, `${saidFarDown} corregido`);
  const afterwards = await narrow.messages.list(farDown.id, { atLeast: 1 });
  if (!afterwards.some(message => message.body === `${saidFarDown} corregido`)) {
    throw new Error("The correction did not take outside the window");
  }

  await narrow.logout().catch(() => undefined);

  // Somebody acting on a conversation without opening it first, which is what a notification leads to. Nothing
  // has reached for it, so this is the case where the window has to fetch it on its own.
  const untouched = new MessagingClient({
    adapter: new MatrixJsAdapter({ conversationWindow: 5 }),
    storage: new InMemoryStorage()
  });
  await untouched.login({ ...alice, homeserver, deviceName: "RelayKit window smoke (untouched)" });
  await untouched.start();
  const straightIn = await untouched.messages.send(farDown.id, `sin-abrir-${Date.now()}`);
  if (straightIn.status !== "sent") {
    throw new Error(`Saying something without opening it first left it as ${straightIn.status}`);
  }

  // Marking as read is what a notification leads to, and nothing has been opened. Forwards only: a marker does
  // not go back, so what is marked is the newest thing there.
  await untouched.messages.markRead(farDown.id, straightIn.id);
  const readUpTo = (await untouched.conversations.list({ limit: 200 }))
    .find(item => item.id === farDown.id)?.lastReadMessageId;
  if (readUpTo !== straightIn.id) {
    throw new Error(`Marking as read without opening it first did not take: ${readUpTo}`);
  }
  await untouched.logout().catch(() => undefined);

  // Changing what a conversation says about itself, as the only thing this client ever does with it.
  const settings = new MessagingClient({
    adapter: new MatrixJsAdapter({ conversationWindow: 5 }),
    storage: new InMemoryStorage()
  });
  await settings.login({ ...alice, homeserver, deviceName: "RelayKit window smoke (settings)" });
  await settings.start();
  if ((await settings.conversations.list()).some(item => item.id === neverTouched.id)) {
    throw new Error("The conversation being tried is inside the window, so this proves nothing");
  }
  // Marking a favourite goes first, and on purpose: it is account data, so unlike saying something or
  // describing the conversation it does not move it to the front of the window. This is the harder case.
  const favourited = await settings.conversations.setFavourite(neverTouched.id, true);
  if (favourited.isFavourite !== true) {
    throw new Error("Marking a favourite outside the window did not take");
  }
  await settings.conversations.setFavourite(neverTouched.id, false);

  const describedAs = `fuera de la ventana ${Date.now()}`;
  const described = await settings.conversations.setTopic(neverTouched.id, describedAs);
  if (described.topic !== describedAs) {
    throw new Error(`Describing a conversation outside the window did not take: ${described.topic}`);
  }

  await settings.logout().catch(() => undefined);

  await windowed.logout().catch(() => undefined);
  console.log(`RelayKit window smoke check passed (caught up in ${catchingUp.took} ms, and reached past the window)`);
}

main().then(() => process.exit(0)).catch(error => {
  console.error(`RelayKit window smoke check failed: ${error.message}`);
  process.exit(1);
});
