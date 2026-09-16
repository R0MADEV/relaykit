import { registerAccount, closeWhatWasMade } from "./fresh-accounts.mjs";

// Who is in a conversation, asked of a real homeserver.
//
// A conversation that does not know who is in it is not a small inconvenience. A list cannot draw the people
// in it, and the calls break in a way nobody would connect to this: the SDK looks up the person on the other
// end to hand over their audio, does not find them, and the caller hears silence with the call showing as
// connected.
//
// So this asks the plain question. Alice invites bob, bob accepts, and alice has to see him.

async function waitFor(description, check, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function run() {
  // Named after nobody. Accounts made for a check share the homeserver's directory with the fixed ones, and
  // an account called something-bob answers a search for "bob" — enough of them and the real bob falls off
  // the end of the results, which is a check failing somewhere else entirely because of this one.
  const alice = await registerAccount("participants-host", "host-participants");
  const bob = await registerAccount("participants-guest", "guest-participants");

  const conversation = await alice.client.conversations.create({
    participantIds: [bob.userId],
    title: `Who is in here ${Date.now()}`
  });

  // Invited, and not in yet: alice has to be able to tell one from the other.
  const invited = await waitFor("bob to show up as invited", async () => {
    const seen = (await alice.client.conversations.list()).find(item => item.id === conversation.id);
    return seen?.invitedIds?.includes(bob.userId) ? seen : undefined;
  });
  if (!invited.participantIds.includes(bob.userId)) {
    throw new Error("Somebody invited is not counted as being in the conversation");
  }

  await waitFor("bob to see the invitation", async () =>
    (await bob.client.conversations.list()).some(item => item.id === conversation.id)
  );
  await bob.client.conversations.join(conversation.id);

  // The point of all this: bob accepted, so alice has to see him as in rather than as invited.
  await waitFor("alice to see bob has accepted", async () => {
    const seen = (await alice.client.conversations.list()).find(item => item.id === conversation.id);
    return (
      seen?.participantIds.includes(bob.userId) === true && seen.invitedIds?.includes(bob.userId) !== true
    );
  });

  const asItStands = (await alice.client.conversations.list()).find(item => item.id === conversation.id);
  if (asItStands.invitedIds?.includes(bob.userId)) {
    throw new Error("Bob is in the conversation and still counts as waiting to accept");
  }

  await alice.client.stop();
  await bob.client.stop();
  console.log("RelayKit participants smoke check passed (a conversation knows who is in it)");
}

run()
  .finally(closeWhatWasMade)
  .catch(error => {
    console.error(`RelayKit participants smoke check failed: ${error.message}`);
    process.exit(1);
  });
