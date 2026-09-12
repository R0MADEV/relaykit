import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createClient } from "matrix-js-sdk";

/**
 * The certificate signs itself, so this has to be told to trust it, and that can only be said before Node
 * starts. Rather than leave that to however this happens to be launched — which made it fail when run
 * directly and pass through npm — it is said here and this starts again.
 *
 * Told to trust one certificate, not told to stop checking: turning verification off would be checking that
 * something answers on a port, which is not the question.
 */
const certificate = process.env.RELAYKIT_TLS_CERT ?? "infrastructure/matrix/data/tls.crt";
if (!process.env.NODE_EXTRA_CA_CERTS && existsSync(certificate)) {
  const again = spawnSync(process.execPath, [...process.argv.slice(1)], {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: certificate },
    stdio: "inherit"
  });
  process.exit(again.status ?? 1);
}

// The homeserver answering over https, which is how any application that is not a local experiment will
// reach it.
//
// Everything else is checked against `http://localhost`, which the browser treats as a secure origin by
// exception. That exception is the only reason the encrypted local store works there, so nothing so far has
// ever exercised what a real deployment does: a certificate, a name that is not localhost, and a client that
// has to accept it.

const homeserver = process.env.MATRIX_HOMESERVER_TLS ?? "https://localhost:8448";

async function run() {
  const client = createClient({ baseUrl: homeserver });

  const versions = await client.getVersions().catch(error => {
    throw new Error(`The homeserver was asked over https and said: ${error.message}`);
  });
  if (!versions?.versions?.length) {
    throw new Error("The homeserver answered over https without saying which versions it speaks");
  }

  // Answering is not enough: what matters is that a client can do something real over it.
  const flows = await client.loginFlows();
  if (!flows.flows?.some(flow => flow.type === "m.login.password")) {
    throw new Error("The homeserver answers over https but will not let anybody in");
  }

  console.log(`RelayKit tls smoke check passed (${homeserver}, ${versions.versions.length} versions)`);
}

run().catch(error => {
  console.error(`RelayKit tls smoke check failed: ${error.message}`);
  process.exit(1);
});
