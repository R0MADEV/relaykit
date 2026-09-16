// How big the public surface actually is, counted instead of remembered.
//
// The architecture notes kept saying 126 operations and 533 lines long after both had moved, because both
// were typed in by hand. Nobody notices a number going stale. CI does.
import { readFileSync } from "node:fs";

const source = readFileSync("packages/core/src/client.ts", "utf8");
const groups = {};
let inside;
for (const line of source.split("\n")) {
  const opens = /^\s+readonly (\w+) = \{/.exec(line);
  if (opens) {
    inside = opens[1];
    groups[inside] = 0;
    continue;
  }
  if (inside && /^\s+\};?\s*$/.test(line)) inside = undefined;
  else if (inside && /^\s+\w+: \(/.test(line)) groups[inside] += 1;
}
const onTheClient = [...source.matchAll(/^ {2}(?:async )?(\w+)\(/gm)]
  .map(found => found[1])
  .filter(name => name !== "constructor");
const grouped = Object.values(groups).reduce((all, one) => all + one, 0);

const counted = {
  operations: grouped + onTheClient.length,
  groups: Object.keys(groups).length,
  // Without the empty string a trailing newline leaves behind, which is not a line.
  lines: source.replace(/\n$/, "").split("\n").length,
  requiredOfAnAdapter: (readFileSync("packages/core/src/adapter.ts", "utf8").match(/^ {2}[a-z]\w*\(/gm) ?? [])
    .length,
  capabilities: (
    readFileSync("packages/core/src/capabilities.ts", "utf8").match(/^export interface \w+Adapter/gm) ?? []
  ).length,
  errorCodes: (readFileSync("packages/core/src/errors.ts", "utf8").match(/^ {2}\| "[A-Z_]+"/gm) ?? []).length
};

console.log(`RELAYKIT_API ${JSON.stringify(counted)}`);

const wrong = [];
// What the architecture notes claim, read back out of them. A number nobody checks is a number that lies —
// and a claim with no marker beside it is not checked, so those are hunted too.
const notes = readFileSync("ARCHITECTURE.md", "utf8");

// The README says the same number in prose. It said eighteen while listing eighteen, long after there were
// twenty-two, because nothing compared it with anything.
const readme = readFileSync("README.md", "utf8");
const saidInTheReadme = /\*\*(\d+) capacidades opcionales\*\*/.exec(readme);
if (saidInTheReadme && Number(saidInTheReadme[1]) !== counted.capabilities) {
  wrong.push(`capabilities: README.md says ${saidInTheReadme[1]}, it is ${counted.capabilities}`);
}
for (const [what, is] of Object.entries(counted)) {
  const claimed = new RegExp(`<!-- ${what}: (\\d+) -->`).exec(notes);
  if (!claimed) continue;
  if (Number(claimed[1]) !== is) wrong.push(`${what}: ARCHITECTURE.md says ${claimed[1]}, it is ${is}`);
}
// Any number of operations written in prose without a marker beside it. One of these said 155 for a day
// while two others said 156, and nothing noticed, because only the marked ones were ever compared.
for (const [, said] of notes.matchAll(/(?<!--> )(?<!-->)\b(\d+) operaciones/g)) {
  if (Number(said) !== counted.operations) {
    wrong.push(`operations: ARCHITECTURE.md says ${said} somewhere with no marker beside it`);
  }
}

// And the same numbers written in prose anywhere else they are claimed. The package notes said the storage
// derived its key from a device secret months after it stopped being the only way; a number is easier to
// check than a sentence, so at least the numbers are checked everywhere they appear.
//
// The changelog and the roadmap are left out on purpose: one says what a number used to be, and the other
// says what it might become. Neither is a claim about today.
const saidInProse = {
  operations: /(\d+) operaciones/g,
  groups: /(\d+) grupos/g,
  capabilities: /(\d+) capacidades/g,
  requiredOfAnAdapter: /(\d+) métodos obligatorios/g,
  errorCodes: /(\d+) códigos/g
};
const alsoClaiming = [
  "ARCHITECTURE.md",
  "README.md",
  "API.md",
  "packages/core/README.md",
  "packages/matrix-js/README.md",
  "packages/in-memory/README.md",
  "packages/browser-storage/README.md",
  "packages/web/README.md",
  "examples/web/README.md"
];
for (const where of alsoClaiming) {
  const text = readFileSync(where, "utf8");
  for (const [what, pattern] of Object.entries(saidInProse)) {
    for (const [, said] of text.matchAll(pattern)) {
      if (Number(said) !== counted[what]) {
        wrong.push(`${what}: ${where} says ${said}, it is ${counted[what]}`);
      }
    }
  }
}

if (wrong.length > 0) {
  console.error(`The architecture notes are out of date:\n  ${wrong.join("\n  ")}`);
  process.exit(1);
}
