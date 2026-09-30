/**
 * The few pieces of the verifier's path language that more than one package
 * has to agree on: where a filter's `]` is, and where its `&` separators are,
 * when a value inside may be a quoted string containing either.
 *
 * Shared so that the compiler that validates a path, the verifier that
 * resolves it, and the projection that checks its fields cannot drift on the
 * one question that decides whether a value written by an outsider can change
 * the meaning of the path around it.
 */

/** Index of the `]` closing the `[` at `open`, skipping quoted strings; -1 if none. */
export function closingBracket(path: string, open: number): number {
  let quoted = false;
  for (let i = open + 1; i < path.length; i += 1) {
    const char = path[i];
    if (quoted) {
      if (char === '\\') i += 1;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ']') return i;
  }
  return -1;
}

/** Splits the inside of a filter on `&`, leaving quoted strings intact. */
export function splitClauses(inner: string): string[] {
  const clauses: string[] = [];
  let buffer = '';
  let quoted = false;
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i]!;
    if (quoted) {
      buffer += char;
      if (char === '\\' && i + 1 < inner.length) {
        buffer += inner[i + 1];
        i += 1;
      } else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      buffer += char;
    } else if (char === '&') {
      clauses.push(buffer);
      buffer = '';
    } else buffer += char;
  }
  clauses.push(buffer);
  return clauses;
}

/** Every filter body in a path, in order. */
export function filterBodies(path: string): string[] {
  const bodies: string[] = [];
  for (let i = 0; i < path.length; i += 1) {
    if (path[i] !== '[') continue;
    const close = closingBracket(path, i);
    if (close === -1) break;
    bodies.push(path.slice(i + 1, close));
    i = close;
  }
  return bodies;
}

/** A path with every filter removed, for walking its property segments. */
export function withoutFilters(path: string): string {
  let out = '';
  for (let i = 0; i < path.length; i += 1) {
    if (path[i] !== '[') {
      out += path[i];
      continue;
    }
    const close = closingBracket(path, i);
    if (close === -1) return out;
    i = close;
  }
  return out;
}
