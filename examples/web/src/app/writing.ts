/**
 * What somebody is writing, and what it turns into on the wire.
 *
 * A handful of marks rather than markdown: the toolbar of the design has six buttons, and a message carries
 * its text and the same text as HTML. Anything richer than this belongs to whoever wants it, in a library
 * that does it properly.
 */

/** What the box says and where the cursor is in it. */
export interface Writing {
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

export type Style = "bold" | "italic" | "code" | "link";

/** The marks each style is written with, and where the cursor lands when there was nothing selected. */
const marks: Readonly<Record<Style, readonly [string, string]>> = {
  bold: ["**", "**"],
  italic: ["_", "_"],
  code: ["`", "`"],
  // The text is what was selected and the cursor goes where the address does, which is the part still missing.
  link: ["[", "]()"]
};

export function wrapped(writing: Writing, style: Style): Writing {
  const [opens, closes] = marks[style];
  const chosen = writing.text.slice(writing.from, writing.to);
  const text = writing.text.slice(0, writing.from) + opens + chosen + closes + writing.text.slice(writing.to);
  const after = writing.from + opens.length;
  // A link is the one that leaves the cursor past the text, inside the brackets where the address goes.
  if (style === "link") return { text, from: after + chosen.length + 2, to: after + chosen.length + 2 };
  return { text, from: after, to: after + chosen.length };
}

/**
 * The same thing said in HTML, when it is said any differently. Nothing when the marks add nothing, because
 * a message that carries its own text twice is a message that can disagree with itself.
 */
export function asHtml(text: string): string | undefined {
  const marked = safe(text);
  const styled = marked
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\s)_([^_]+)_/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole, said: string, where: string) =>
      // Anybody can write an address, and an address is the one part of this that acts. Only the two schemes
      // a message has any business carrying are made into a link; the rest stays the text somebody typed.
      isSomewhereToGo(where) ? `<a href="${where}">${said}</a>` : whole
    );
  return styled === marked ? undefined : styled;
}

function isSomewhereToGo(where: string): boolean {
  return where.startsWith("https://") || where.startsWith("http://");
}

/** Who a message names, read off what it says, so they can be told they were named. */
export function mentioned(text: string): readonly string[] {
  const named = text.match(/@[a-z0-9._=\-/+]+:[a-z0-9.-]+/gi) ?? [];
  return [...new Set(named)];
}

/** Text on its way into markup. Anybody can call a conversation `<img onerror=…>` and somebody will. */
export function safe(text: string): string {
  return text.replace(/[&<>"]/g, character => escapes[character] ?? character);
}

const escapes: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;"
};
