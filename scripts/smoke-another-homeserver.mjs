import { spawn } from "node:child_process";

// The same checks, against a homeserver that is not Synapse.
//
// Everything else here runs against Synapse, so anything the library leant on that only Synapse does would
// never show up. This is what tells the difference between a library for Matrix and a library for Synapse.
//
// Not everything can run: some of it is Dendrite not having something, which is its business and not a
// failure of this library. What is listed here is what has to keep working, so that losing one of them is
// noticed.
const homeserver = process.env.MATRIX_HOMESERVER_OTHER ?? "http://localhost:8108";

const hasToWork = [
  "registration", "participants", "live", "matrix", "devices",
  "verification", "user-verification", "qr", "recovery", "revocation"
];

/**
 * What this homeserver does not do, written down rather than left as a check that fails. Each one is a
 * difference an application would meet too, which is the reason for saying it out loud.
 */
const knownDifferences = {
  window: "no simplified sliding sync (MSC3575), which is Synapse's",
  chat: "no thumbnails: a picture asked for small comes back whole",
  group: "no knocking: /knock is not there",
  relaykit: "unread counts do not arrive"
};

function run(name) {
  return new Promise(resolve => {
    const child = spawn("node", [`scripts/smoke-${name}.mjs`], {
      env: { ...process.env, MATRIX_HOMESERVER: homeserver },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let said = "";
    child.stdout.on("data", chunk => { said += chunk; });
    child.stderr.on("data", chunk => { said += chunk; });
    child.on("close", code => resolve({ name, ok: code === 0, said }));
  });
}

const results = [];
for (const name of hasToWork) results.push(await run(name));

const broken = results.filter(result => !result.ok);
for (const result of broken) {
  const why = result.said.split("\n").filter(line => line.includes("failed")).pop() ?? "no reason given";
  console.error(`  ${result.name}: ${why.trim()}`);
}

const differences = Object.entries(knownDifferences).map(([name, why]) => `${name} (${why})`).join("; ");
if (broken.length > 0) {
  console.error(`RelayKit another-homeserver smoke check failed: ${broken.length} of ${hasToWork.length} broke`);
  process.exit(1);
}
console.log(`RelayKit another-homeserver smoke check passed (${hasToWork.length} against ${homeserver})`);
console.log(`  not run, and why: ${differences}`);
