import { registerAccount, closeWhatWasMade } from "./fresh-accounts.mjs";

// Editing, answering and threads inside an encrypted conversation, which nothing else here checked.
//
// What a message is about — the one it edits, the one it answers, the thread it hangs from — travels outside
// the encryption. It has to: a homeserver that cannot read the message still has to know what to file it
// under. So an encrypted conversation carries it somewhere else than a plain one, and code that reads it from
// the wrong place works perfectly until somebody turns encryption on.
//
// The checks here were split in a way that hid exactly that: encrypted conversations were used for crypto,
// and edits and threads were checked on plain ones.

async function waitFor(description, check, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function run() {
  const alice = await registerAccount("secret-host", "host-secret");
  const bob = await registerAccount("secret-guest", "guest-secret");

  const conversation = await alice.client.conversations.create({
    participantIds: [bob.userId],
    title: `Encrypted ${Date.now()}`,
    encrypted: true
  });
  await waitFor("bob to see the invitation", async () =>
    (await bob.client.conversations.list()).some(item => item.id === conversation.id)
  );
  await bob.client.conversations.join(conversation.id);

  const readByBob = body =>
    waitFor(`bob to read "${body}"`, async () => {
      const messages = await bob.client.messages.list(conversation.id);
      return messages.find(message => message.body === body && !message.undecryptable);
    });

  // Something said, and then said better.
  const said = await alice.client.messages.send(conversation.id, "lo dije mal");
  await readByBob("lo dije mal");
  await alice.client.messages.edit(conversation.id, said.id, "lo dije bien");

  const edited = await waitFor("bob to see the edit as an edit", async () => {
    const messages = await bob.client.messages.list(conversation.id);
    const same = messages.find(message => message.id === said.id);
    return same?.body === "lo dije bien" ? { messages, same } : undefined;
  });
  // The point: an edit read from the wrong place arrives looking like it was said all over again.
  const saidTwice = edited.messages.filter(message => message.body.includes("lo dije")).length;
  if (saidTwice !== 1) {
    throw new Error(`An edit arrived as a new message: ${saidTwice} of them say it`);
  }

  // Something answered.
  const answer = await alice.client.messages.send(conversation.id, "claro que sí", { replyTo: said.id });
  const seenAnswer = await readByBob("claro que sí");
  if (seenAnswer.replyToId !== said.id) {
    throw new Error(`An answer lost what it was answering: ${seenAnswer.replyToId}`);
  }
  if (answer.id === said.id) throw new Error("The answer replaced what it answered");

  // Something said inside a thread. It belongs in the thread and nowhere else: a thread reply that shows up
  // in the middle of the conversation is a thread that failed to be one.
  await alice.client.messages.send(conversation.id, "dentro del hilo", { threadId: said.id });
  const inThread = await waitFor("bob to read what was said in the thread", async () => {
    const thread = await bob.client.messages.thread(conversation.id, said.id);
    return thread.find(message => message.body === "dentro del hilo" && !message.undecryptable);
  });
  if (inThread.threadId !== said.id) {
    throw new Error(`A thread reply landed outside its thread: ${inThread.threadId}`);
  }
  const conversationItself = await bob.client.messages.list(conversation.id);
  if (conversationItself.some(message => message.body === "dentro del hilo")) {
    throw new Error("What was said inside a thread is filling the conversation as well");
  }

  // And a reaction, which is a relation too.
  await bob.client.reactions.add(conversation.id, said.id, "👍");
  await waitFor("alice to see the reaction", async () => {
    const messages = await alice.client.messages.list(conversation.id);
    return messages.some(message => message.id === said.id);
  });

  await alice.client.stop();
  await bob.client.stop();
  console.log("RelayKit encrypted chat smoke check passed (edits, answers and threads survive encryption)");
}

run()
  .finally(closeWhatWasMade)
  .catch(error => {
    console.error(`RelayKit encrypted chat smoke check failed: ${error.message}`);
    process.exit(1);
  });
