// The reference, written from the code rather than from memory.
//
// API.md is prose, and prose is where the reasons live: why something exists, what not to do with it, the
// four traps. What prose is bad at is staying true about parameters — one renamed argument and the page is
// lying, with nothing to notice it. So the part that is only facts is generated from `client.ts`, which is a
// façade of one line per operation and therefore already says exactly what each one takes and gives back.
//
// `--check` says whether what is in the file is what the code would produce now. That is what CI runs.
import { readFileSync, writeFileSync } from "node:fs";

const from = "packages/core/src/client.ts";
const into = "API.md";
const opens = "<!-- generated: the operations -->";
const closes = "<!-- end generated -->";

const source = readFileSync(from, "utf8").split("\n");

/** What each group of operations is for, in one line. The only part of this page written by a person. */
const whatEachGroupIsFor = {
  conversations: "Las conversaciones: abrirlas, entrar, salir, y todo lo que se hace a una entera",
  messages: "Lo que se dice dentro de una conversación",
  calls: "Llamadas y videollamadas",
  reactions: "Reaccionar a un mensaje",
  polls: "Preguntar algo y contar las respuestas",
  location: "Compartir dónde estás, mientras te mueves",
  media: "Archivos: bajarlos, y qué acepta el servidor",
  users: "Las personas: quién es quién, y a quién no quieres leer",
  presence: "Si alguien está delante de su pantalla",
  sso: "Entrar con el sistema de identidad de la organización",
  devices: "Las sesiones de esta cuenta, y cuáles son de fiar",
  verification: "Comprobar que otra sesión o persona es quien dice",
  crypto: "Las claves: protegerlas y recuperarlas",
  push: "Avisos cuando la aplicación está cerrada",
  spaces: "Agrupar conversaciones",
  account: "La cuenta: contraseña, direcciones, y darse de baja"
};

const groups = [];
const onTheClient = [];
const unreadable = [];
let inside;
for (const [at, line] of source.entries()) {
  const starts = /^ {2}readonly (\w+) = \{$/.exec(line);
  if (starts) {
    inside = { name: starts[1], operations: [] };
    groups.push(inside);
    continue;
  }
  if (inside && /^ {2}\};?$/.test(line)) {
    inside = undefined;
    continue;
  }
  if (inside) {
    // Only the entries, not the bodies they wrap onto the next line.
    if (!/^ {4}\w+: \(/.test(line)) continue;
    // A long one is wrapped over several lines by the formatter, so it is put back together before being
    // read. Everything up to the arrow is the signature; what comes after is the body, which is not the
    // reference's business.
    let whole = line;
    for (let next = at + 1; !whole.includes(" =>") && next < source.length; next += 1) {
      whole += ` ${(source[next] ?? "").trim()}`;
    }
    const signature = /^ {4}(\w+): \((.*)\): ([^=]+) =>/.exec(
      whole.replace(/\s+/g, " ").replace(/^ /, "    ")
    );
    if (!signature) {
      unreadable.push(`${from}:${at + 1} ${line.trim()}`);
      continue;
    }
    inside.operations.push({ name: signature[1], takes: signature[2], gives: signature[3].trim() });
    continue;
  }
  const alone = /^ {2}(?:async )?(\w+)\((.*)\): ([^{]+) \{$/.exec(line);
  if (alone && alone[1] !== "constructor") {
    onTheClient.push({ name: alone[1], takes: alone[2], gives: alone[3].trim() });
  }
}

// A generator that quietly leaves things out is worse than no generator: the page looks complete and is not.
if (unreadable.length > 0) {
  console.error(
    `Could not read these, so the reference would be missing them:\n  ${unreadable.join("\n  ")}`
  );
  process.exit(1);
}

const written = [
  opens,
  "",
  "<!-- Escrito por `npm run write:api` desde `packages/core/src/client.ts`. No editar a mano. -->",
  "",
  "Todo devuelve una promesa salvo donde se diga otra cosa.",
  ""
];
for (const group of groups) {
  written.push(`### \`client.${group.name}\``, "");
  const forWhat = whatEachGroupIsFor[group.name];
  if (forWhat) written.push(forWhat, "");
  written.push("```ts");
  for (const each of group.operations) {
    written.push(`${each.name}(${each.takes}): ${each.gives}`);
  }
  written.push("```", "");
}
written.push("### En el propio cliente", "", "```ts");
for (const each of onTheClient) written.push(`client.${each.name}(${each.takes}): ${each.gives}`);
written.push("```", "", closes);

const page = readFileSync(into, "utf8");
const from_at = page.indexOf(opens);
const to_at = page.indexOf(closes);
if (from_at === -1 || to_at === -1) {
  console.error(`${into} has nowhere to put this: it needs ${opens} and ${closes}`);
  process.exit(1);
}
const now = page.slice(0, from_at) + written.join("\n") + page.slice(to_at + closes.length);

const counted = groups.reduce((all, one) => all + one.operations.length, 0) + onTheClient.length;
if (process.argv.includes("--check")) {
  if (now !== page) {
    console.error(`${into} is not what the code says any more. Run: npm run write:api`);
    process.exit(1);
  }
  console.log(`RELAYKIT_API_REFERENCE ${JSON.stringify({ operations: counted, upToDate: true })}`);
  process.exit(0);
}
writeFileSync(into, now);
console.log(`RELAYKIT_API_REFERENCE ${JSON.stringify({ operations: counted, written: true })}`);
