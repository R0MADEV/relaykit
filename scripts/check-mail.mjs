// Adding an address to an account, and getting back into one whose password is forgotten.
//
// Both end in a message this side cannot see, and a check that stops at "the homeserver accepted the request"
// proves the half that was never in doubt. So this one reads the mailbox: the development environment sends
// to Mailpit, which delivers to nobody and hands it over by HTTP.
//
// The links are followed as a person follows them, including Synapse's own "confirm changing my password"
// page. That page really is there, and skipping it would skip the step where somebody says yes.
import { MatrixJsAdapter } from "@relaykit/matrix-js";

const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const mailbox = process.env.RELAYKIT_MAILBOX ?? "http://localhost:8025";
const who = `check-mail-${Date.now()}`;
const address = `${who}@deitu.example`;
const first = "first-password";
const second = "second-password";
const detail = { who, address };

function report(ok, summary) {
  console.log(`RELAYKIT_MAIL_RESULT ${JSON.stringify({ ok, summary, detail })}`);
  process.exit(ok ? 0 : 1);
}

/** An account of its own, so nothing here can lock anybody else out of the development homeserver. */
async function makeAnAccount() {
  const start = await fetch(`${homeserver}/_matrix/client/v3/register`, {
    method: "POST",
    body: JSON.stringify({ username: who, password: first })
  });
  const asked = await start.json();
  const done = await fetch(`${homeserver}/_matrix/client/v3/register`, {
    method: "POST",
    body: JSON.stringify({
      username: who,
      password: first,
      auth: { type: "m.login.dummy", session: asked.session }
    })
  });
  if (!done.ok) throw new Error(`the homeserver would not make the account: ${await done.text()}`);
}

const alreadyRead = new Set();

/** The link in the next message to arrive at that address. Ones read before do not count as arriving. */
async function linkSentTo(to) {
  for (let tries = 0; tries < 60; tries += 1) {
    const list = await (await fetch(`${mailbox}/api/v1/messages?limit=50`)).json();
    const sent = list.messages?.find(
      each => each.To?.some(one => one.Address === to) && !alreadyRead.has(each.ID)
    );
    if (sent) {
      alreadyRead.add(sent.ID);
      const body = await (await fetch(`${mailbox}/api/v1/message/${sent.ID}`)).json();
      const found = /https?:\/\/[^\s"'<>]+/.exec(body.Text ?? body.HTML ?? "");
      if (found) return found[0];
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`nothing arrived at ${to}`);
}

/**
 * Following the link, and saying yes to whatever it asks.
 *
 * Synapse answers some of them with a page holding a hidden form and a button, which a person presses. This
 * presses it: the confirmation is a real step and pretending it is not would skip the only part where
 * somebody says they meant it.
 */
async function follow(link) {
  const page = await (await fetch(link)).text();
  const asksToConfirm = page.includes('<form method="post">');
  if (!asksToConfirm) return;
  const fields = new URLSearchParams();
  for (const [, name, value] of page.matchAll(/name="([^"]+)" value="([^"]+)"/g)) fields.set(name, value);
  const confirmed = await fetch(link, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: fields
  });
  if (!confirmed.ok) throw new Error(`the confirmation page refused: ${confirmed.status}`);
}

async function canSignInWith(password) {
  const answer = await fetch(`${homeserver}/_matrix/client/v3/login`, {
    method: "POST",
    body: JSON.stringify({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: who },
      password
    })
  });
  return answer.ok;
}

async function main() {
  await makeAnAccount();
  const adapter = new MatrixJsAdapter();
  const session = await adapter.login({
    homeserver,
    username: who,
    password: first,
    deviceName: "RelayKit mail check"
  });
  await adapter.start(session, {});

  // An address is nobody's until they prove it: nothing is added by asking.
  const asked = await adapter.account.startAddingEmail(address);
  const beforeProving = await adapter.account.listAddresses();
  if (beforeProving.length > 0) {
    return report(false, "the address was added before anybody proved it was theirs");
  }
  await follow(await linkSentTo(address));
  await adapter.account.finishAddingAddress(asked, first);
  detail.added = await adapter.account.listAddresses();
  if (!detail.added.some(each => each.address === address)) {
    return report(false, "the address was proved and still is not on the account");
  }

  await adapter.stop();

  // And the way back in for somebody who cannot get in at all.
  const reset = await adapter.account.startResettingPassword(homeserver, address);
  await follow(await linkSentTo(address));
  await adapter.account.finishResettingPassword(homeserver, reset, second);

  if (await canSignInWith(first)) return report(false, "the old password still works");
  if (!(await canSignInWith(second))) return report(false, "the new password does not work either");

  report(true, `proved ${address} and got back in with a password reset by mail`);
}

main().catch(error => report(false, error.message));
