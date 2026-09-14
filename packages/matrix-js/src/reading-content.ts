/**
 * Reading a field off something a homeserver sent.
 *
 * What arrives over the wire is whatever the other end chose to send, so every field is read as the thing it
 * is supposed to be or not read at all. Saying it is a shape and hoping — which is what a cast is — pushes
 * the mistake to whoever draws it, in another file, much later.
 *
 * Read off the object's own description of itself: a field name is not a way to reach `constructor` or
 * anything else every object in the language happens to carry.
 */
function ownValueAt(said: unknown, key: string): unknown {
  if (typeof said !== "object" || said === null) return undefined;
  return Object.getOwnPropertyDescriptor(said, key)?.value;
}

export function stringAt(said: unknown, key: string): string | undefined {
  const found = ownValueAt(said, key);
  return typeof found === "string" ? found : undefined;
}

/** A number, and a real one: `NaN` and infinity are what arithmetic on rubbish leaves behind. */
export function numberAt(said: unknown, key: string): number | undefined {
  const found = ownValueAt(said, key);
  return typeof found === "number" && Number.isFinite(found) ? found : undefined;
}

export function stringsAt(said: unknown, key: string): readonly string[] {
  const found = ownValueAt(said, key);
  return Array.isArray(found) ? found.filter(each => typeof each === "string") : [];
}

export function numbersAt(said: unknown, key: string): readonly number[] {
  const found = ownValueAt(said, key);
  return Array.isArray(found) ? found.filter(each => typeof each === "number") : [];
}
