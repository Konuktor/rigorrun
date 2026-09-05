/**
 * Reading an OpenAPI document, and not much more than reading it.
 *
 * No validator. `@apidevtools/swagger-parser` was the obvious choice and was
 * rejected: it brings ajv and a reference resolver, about ten transitive
 * packages, and it throws on documents that real APIs ship every day. A tool
 * whose job is to test somebody's system should not refuse to look at it
 * because a description field is in the wrong place.
 *
 * So this is deliberately permissive. It resolves local `$ref`s, gives up
 * politely on remote ones, refuses to recurse forever, and reports what it
 * could not read rather than throwing. Anything it cannot make sense of becomes
 * an operation with fewer arguments, or no operation at all — and RigorRun says
 * which, because an argument silently dropped is a case that silently cannot be
 * generated.
 */

export interface OpenApiDocument {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; version?: string };
  servers?: { url?: string }[];
  paths?: Record<string, unknown>;
  components?: Record<string, unknown>;
}

/**
 * Two different limits, which is the point of them being two constants.
 *
 * `MAX_REF_DEPTH` bounds how far a `$ref` chain may be followed, and it is
 * small because a chain that long is a cycle or an attack. `MAX_STRUCTURE_DEPTH`
 * bounds ordinary nesting, and it has to be generous: an OpenAPI document is
 * already ten levels deep before anything unusual happens — path, path item,
 * operation, requestBody, content, media type, schema, properties, the property
 * itself, its enum, an entry in that enum. Sharing one budget between the two
 * silently truncated exactly that: an enum arrived as a plain string, and the
 * boundary cases that depend on knowing the closed set were never generated.
 */
const MAX_REF_DEPTH = 8;
const MAX_STRUCTURE_DEPTH = 40;
/** Total nodes, so a wide document cannot do what a deep one cannot. */
const MAX_NODES = 200_000;
const MAX_SPEC_BYTES = 8 * 1024 * 1024;

export class OpenApiParseError extends Error {}

/**
 * Parses a document from text.
 *
 * JSON needs nothing. YAML needs a parser, and rather than make every install
 * carry one for the people who never hand it a `.yaml`, it is imported only
 * when the text turns out not to be JSON.
 */
export async function loadDocument(text: string): Promise<OpenApiDocument> {
  if (text.length > MAX_SPEC_BYTES) {
    throw new OpenApiParseError(
      `That document is ${Math.round(text.length / 1024 / 1024)}MB, which is larger than ` +
        'RigorRun will read. If it is genuinely that big, point RigorRun at the part of your ' +
        'API you want tested rather than all of it.',
    );
  }
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as OpenApiDocument;
    } catch (error) {
      throw new OpenApiParseError(`That is not valid JSON: ${(error as Error).message}`);
    }
  }

  let parse: (input: string) => unknown;
  try {
    // Typed loosely and imported by name at runtime: `yaml` is optional, so
    // this file must compile in an install that does not have it.
    // The specifier is built rather than written, so TypeScript does not try
    // to resolve a module that is optional by design and absent by default.
    const specifier = 'ya' + 'ml';
    const loaded = (await import(/* @vite-ignore */ specifier)) as {
      parse: (input: string) => unknown;
    };
    parse = loaded.parse;
  } catch {
    throw new OpenApiParseError(
      'That document is not JSON, and the YAML reader is not installed. Convert it to JSON, ' +
        'or install `yaml` alongside RigorRun.',
    );
  }
  try {
    return parse(text) as OpenApiDocument;
  } catch (error) {
    throw new OpenApiParseError(`That is not valid YAML: ${(error as Error).message}`);
  }
}

/**
 * Follows a local `$ref` to the thing it names.
 *
 * Remote and file references are not followed. Fetching whatever a document
 * points at is a request RigorRun would be making on the operator's behalf to
 * an address the operator never typed, which is the shape of an SSRF and not
 * worth the convenience.
 */
export function deref(document: OpenApiDocument, node: unknown, depth = 0): unknown {
  if (depth > MAX_REF_DEPTH || node === null || typeof node !== 'object') return node;
  const ref = (node as { $ref?: unknown }).$ref;
  if (typeof ref !== 'string') return node;
  if (!ref.startsWith('#/')) return {};

  let current: unknown = document;
  for (const segment of ref.slice(2).split('/')) {
    if (current === null || typeof current !== 'object') return {};
    current = (current as Record<string, unknown>)[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return deref(document, current, depth + 1);
}

/**
 * Resolves every `$ref` inside a shape so the converter sees plain objects.
 *
 * Idempotent, so calling it on something already resolved costs a walk and
 * changes nothing — which matters, because the operation is resolved once as a
 * whole and its request body is convenient to resolve again on the way past.
 */
export function resolveSchema(
  document: OpenApiDocument,
  node: unknown,
  depth = 0,
  budget = { nodes: MAX_NODES },
): unknown {
  if (depth > MAX_STRUCTURE_DEPTH || budget.nodes <= 0) return {};
  budget.nodes -= 1;
  // `$ref` chains get their own, much smaller allowance.
  const resolved = deref(document, node, 0);
  if (resolved === null || typeof resolved !== 'object') return resolved;
  if (Array.isArray(resolved)) {
    return resolved.map((entry) => resolveSchema(document, entry, depth + 1, budget));
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(resolved as Record<string, unknown>)) {
    out[key] = resolveSchema(document, value, depth + 1, budget);
  }
  return out;
}
