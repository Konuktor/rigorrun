/**
 * OpenAPI operations, as RigorRun understands actions.
 *
 * The whole conversion, and it is short because the interesting work is
 * already done elsewhere: request bodies go through the same
 * `paramsFromInputSchema` an MCP tool's input schema does, because a JSON
 * Schema is a JSON Schema wherever it arrives from. Path and query parameters
 * carry a `schema` of their own, so they reduce to the same thing.
 *
 * What OpenAPI gives that MCP usually does not is a *declared* response shape.
 * That is strictly better evidence for what a record looks like than sampling
 * one and guessing, and it is why the OpenAPI path can often say
 * `declared-schema` where the MCP path has to say `tools-only`.
 */
import {
  SCHEMA_LIMITS,
  assessFromMethod,
  paramsFromInputSchema,
  type DiscoveredTool,
  type UnsupportedParam,
} from '@rigorrun/connector';
import type { ActionParam } from '@rigorrun/environment';
import { resolveSchema, type OpenApiDocument } from './document.ts';

/** How the operator has classified an operation. Only READ is inferred. */
export type OperationClass = 'READ' | 'WRITE' | 'IGNORE';

export interface OpenApiOperation {
  /** RigorRun's name for it: the `operationId`, or one built from the route. */
  name: string;
  method: string;
  /** The template, with `{placeholders}` still in it. */
  path: string;
  /** Which parameters go where, so `call` can build the request. */
  placement: Record<string, 'path' | 'query' | 'header' | 'body'>;
  classification: OperationClass;
  /** The declared 2xx response schema, when there is one. */
  responseSchema?: unknown;
  tool: DiscoveredTool;
}

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'] as const;

/** A name for an operation that has no `operationId`, and does not collide. */
function nameFor(method: string, path: string): string {
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+/g, '_'));
  return [method.toLowerCase(), ...parts].join('_').replace(/_+/g, '_');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The declared schema of the first 2xx JSON response, if there is one. */
function responseSchemaOf(document: OpenApiDocument, operation: Record<string, unknown>): unknown {
  const responses = isObject(operation['responses']) ? operation['responses'] : undefined;
  if (!responses) return undefined;
  for (const [status, value] of Object.entries(responses)) {
    if (!/^2\d\d$/.test(status)) continue;
    const response = resolveSchema(document, value);
    if (!isObject(response) || !isObject(response['content'])) continue;
    for (const [media, body] of Object.entries(response['content'])) {
      if (!media.includes('json') || !isObject(body)) continue;
      if (body['schema'] !== undefined) return body['schema'];
    }
  }
  return undefined;
}

/**
 * Every operation the document publishes, in a stable order.
 *
 * Nothing here decides what may be *called*. Classification is READ or WRITE
 * from the method, which the HTTP specification makes normative rather than
 * advisory — and RigorRun still will not treat a READ as safe until a person
 * says so, exactly as it will not treat an MCP `readOnlyHint` as safe.
 */
export function operationsFrom(document: OpenApiDocument): OpenApiOperation[] {
  const out: OpenApiOperation[] = [];
  const paths = isObject(document.paths) ? document.paths : {};

  for (const [path, rawItem] of Object.entries(paths)) {
    const item = resolveSchema(document, rawItem);
    if (!isObject(item)) continue;
    // Parameters declared once for every method on this path.
    const shared = Array.isArray(item['parameters']) ? item['parameters'] : [];

    for (const method of METHODS) {
      const raw = item[method];
      if (!isObject(raw)) continue;
      const operation = resolveSchema(document, raw) as Record<string, unknown>;

      const params: ActionParam[] = [];
      const unsupported: UnsupportedParam[] = [];
      const placement: OpenApiOperation['placement'] = {};
      let truncated = false;

      const declared = [
        ...shared,
        ...(Array.isArray(operation['parameters']) ? operation['parameters'] : []),
      ];
      for (const entry of declared.slice(0, SCHEMA_LIMITS.maxProperties)) {
        const parameter = resolveSchema(document, entry);
        if (!isObject(parameter) || typeof parameter['name'] !== 'string') continue;
        const where = parameter['in'];
        if (where !== 'path' && where !== 'query' && where !== 'header') {
          // Cookies, mostly. Reported rather than dropped: an argument
          // RigorRun cannot set is a case it cannot generate.
          unsupported.push({
            name: parameter['name'],
            reason: `it is sent in the ${String(where)}, which RigorRun does not set`,
          });
          continue;
        }
        // One parameter is one property, so the converter can be reused as is.
        const converted = paramsFromInputSchema({
          properties: { [parameter['name']]: parameter['schema'] ?? { type: 'string' } },
          required: parameter['required'] === true ? [parameter['name']] : [],
        });
        params.push(...converted.params);
        unsupported.push(...converted.unsupported);
        for (const param of converted.params) placement[param.name] = where;
      }

      const body = resolveSchema(document, operation['requestBody']);
      if (isObject(body) && isObject(body['content'])) {
        const json = Object.entries(body['content']).find(([media]) => media.includes('json'));
        if (json && isObject(json[1])) {
          const converted = paramsFromInputSchema(json[1]['schema']);
          params.push(...converted.params);
          unsupported.push(...converted.unsupported);
          truncated ||= converted.truncated;
          for (const param of converted.params) placement[param.name] = 'body';
        } else {
          unsupported.push({
            name: 'body',
            reason: 'the request body is not JSON, which RigorRun cannot build',
          });
        }
      }

      const responseSchema = responseSchemaOf(document, operation);
      const readOnly = method === 'get' || method === 'head' || method === 'options';
      out.push({
        name:
          typeof operation['operationId'] === 'string' && operation['operationId'].length > 0
            ? operation['operationId']
            : nameFor(method, path),
        method: method.toUpperCase(),
        path,
        placement,
        // Deprecated operations are still discoverable and never suggested.
        classification: operation['deprecated'] === true ? 'IGNORE' : readOnly ? 'READ' : 'WRITE',
        ...(responseSchema !== undefined ? { responseSchema } : {}),
        tool: {
          name:
            typeof operation['operationId'] === 'string' && operation['operationId'].length > 0
              ? operation['operationId']
              : nameFor(method, path),
          description:
            typeof operation['summary'] === 'string'
              ? operation['summary']
              : typeof operation['description'] === 'string'
                ? operation['description'].slice(0, 500)
                : `${method.toUpperCase()} ${path}`,
          params,
          unsupported,
          schemaTruncated: truncated,
          ...(responseSchema !== undefined ? { outputSchema: responseSchema } : {}),
          // An HTTP method is not an annotation. The document does not get to
          // claim a POST is read-only, so there are no hints to carry.
          hints: {},
          risk: assessFromMethod(method),
        },
      });
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}
