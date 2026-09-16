// Compiles the TypeScript in the documentation, so that a page cannot go on promising something that no
// longer exists.
//
// Seventy-seven blocks across the notes, and nothing ever looked at one of them. A renamed option or a
// method that moved leaves them wrong, silently, for as long as nobody happens to copy one and try it —
// which is the worst way to find out, because by then somebody believed it.
//
// What is checked is that it *compiles*, not that it runs: these are fragments written to be read, and the
// question they have to answer is whether the API they show is the API that exists.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const where = path.join("node_modules", ".relaykit-examples");

/**
 * Names a fragment may lean on without introducing them.
 *
 * A snippet in a page is not a program: it shows one call, and whoever reads it knows what `client` is. So
 * the ones that are always the same thing are declared here — and only when the fragment does not make its
 * own, or the two would collide.
 */
const takenForGranted = [
  ["client", "RkClient"],
  ["session", "RkSession"],
  ["homeserver", "string"],
  ["conversationId", "RkConversationId"],
  ["messageId", "RkMessageId"],
  ["userId", "RkUserId"],
  ["deviceId", "string"],
  ["storageSecret", "string"],
  ["encryptionSecret", "string"],
  ["file", "File"],
  ["message", "RkMessage"],
  ["conversation", "RkConversation"]
];

// Imported under names of its own, so that a fragment importing the same thing does not collide with it.
const preamble = `import type {
  Conversation as RkConversation,
  ConversationId as RkConversationId,
  Message as RkMessage,
  MessageId as RkMessageId,
  MessagingClient as RkClient,
  Session as RkSession,
  UserId as RkUserId
} from "@relaykit/web";
`;

function blocksIn(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const found = [];
  let open;
  let waiting;
  const everywhere = [];
  let generated = false;
  for (const [at, line] of lines.entries()) {
    // The generated reference is signatures, not code: `list(options?: X): Promise<Y>` is not a program.
    if (line.includes("<!-- generated:")) generated = true;
    if (line.includes("<!-- end generated -->")) generated = false;
    // What a fragment needs in order to stand up, without cluttering what somebody reads. Rust's doctests do
    // the same with hidden lines. Written right above the block:
    //   <!-- setup: declare const bytes: Uint8Array; -->
    const setUp = /^<!-- setup: (.*) -->$/.exec(line.trim());
    if (setUp) {
      waiting = (waiting ?? []).concat(setUp[1] ?? "");
      continue;
    }
    // The same, for a page where every fragment leans on the same handful of things. Declared once at the
    // top instead of above forty blocks, which nobody would keep true.
    const forThePage = /^<!-- setup-all: (.*) -->$/.exec(line.trim());
    if (forThePage) {
      everywhere.push(forThePage[1] ?? "");
      continue;
    }
    if (line.trimEnd() === "```ts") {
      open = { startsAt: at + 2, lines: [], skip: generated, setup: waiting ?? [] };
      waiting = undefined;
      continue;
    }
    if (open && line.trimEnd() === "```") {
      if (!open.skip) {
        found.push({
          file,
          startsAt: open.startsAt,
          code: open.lines.join("\n"),
          setup: open.setup,
          everywhere
        });
      }
      open = undefined;
      continue;
    }
    if (open) open.lines.push(line);
  }
  return found;
}

/** Whether a fragment introduces a name itself — plainly, or by taking it out of something else. */
function makesItsOwn(code, name) {
  if (new RegExp(`(const|let|var|function|class)\\s+${name}\\b`).test(code)) return true;
  return new RegExp(`(const|let|var)\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=`).test(code);
}

const files = execFileSync("git", ["ls-files", "*.md"]).toString().trim().split("\n");
const blocks = files.flatMap(blocksIn);

rmSync(where, { recursive: true, force: true });
mkdirSync(where, { recursive: true });

const madeUp = [];
for (const [index, block] of blocks.entries()) {
  const leans = takenForGranted
    .filter(([name]) => new RegExp(`\\b${name}\\b`).test(block.code))
    // Nor when the block makes its own, or a setup line already says what it is.
    .filter(([name]) => !makesItsOwn(block.code, name))
    .filter(([name]) => ![...block.setup, ...block.everywhere].some(l => new RegExp(`\\b${name}\\b`).test(l)))
    .map(([name, type]) => `declare const ${name}: ${type};`)
    .join("\n");
  const name = `block-${String(index).padStart(3, "0")}.ts`;
  // What the page declares for all of it, minus anything this fragment makes for itself.
  const forThePage = block.everywhere.filter(line => {
    const named = /declare (?:const|function) (\w+)/.exec(line);
    if (!named) return true;
    return !makesItsOwn(block.code, named[1] ?? "");
  });
  const setUp = [...forThePage, ...block.setup].join("\n");
  writeFileSync(path.join(where, name), `${preamble}${leans}\n${setUp}\n${block.code}\n`);
  madeUp.push({ name, ...block });
}

writeFileSync(
  path.join(where, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022", "DOM"],
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        exactOptionalPropertyTypes: true,
        skipLibCheck: true,
        noEmit: true,
        // A fragment shows one call and leaves the answer unused, which is not a mistake in a page.
        noUnusedLocals: false,
        noUnusedParameters: false,
        allowImportingTsExtensions: false
      },
      include: ["*.ts"]
    },
    null,
    2
  )
);

let output = "";
try {
  execFileSync("npx", ["tsc", "-p", path.join(where, "tsconfig.json")], { encoding: "utf8" });
} catch (failed) {
  output = `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
}

if (!output.trim()) {
  console.log(`RELAYKIT_EXAMPLES ${JSON.stringify({ blocks: blocks.length, compiled: true })}`);
  process.exit(0);
}

// Said where a person can act on it: the page and the line, not a temporary file nobody has heard of.
const wrong = new Map();
for (const line of output.split("\n")) {
  const at = /block-(\d+)\.ts\((\d+),(\d+)\): (.+)$/.exec(line.trim());
  if (!at) continue;
  const block = madeUp[Number(at[1])];
  if (!block) continue;
  const preambleLines = preamble.split("\n").length - 1;
  const leaning =
    readFileSync(path.join(where, block.name), "utf8").split("\n").length - block.code.split("\n").length - 1;
  const inThePage = block.startsAt + Number(at[2]) - leaning - 1;
  const key = `${block.file}:${inThePage}`;
  if (!wrong.has(key)) wrong.set(key, []);
  wrong.get(key).push(at[4]);
  void preambleLines;
}

console.error(`The examples in the notes no longer compile:\n`);
for (const [at, whats] of wrong) console.error(`  ${at}\n    ${whats.join("\n    ")}`);
console.log(`RELAYKIT_EXAMPLES ${JSON.stringify({ blocks: blocks.length, wrong: wrong.size })}`);
process.exit(1);
