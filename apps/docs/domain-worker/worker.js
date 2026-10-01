// docs.rigorrun.xyz → the docs Pages project.
//
// The zone's DNS cannot be edited with the deploy token, but a Worker custom
// domain creates its own record. This Worker only forwards: the docs are still
// built and deployed to the `rigorrun-docs` Pages project by `pnpm deploy:docs`.
const ORIGIN = 'https://rigorrun-docs.pages.dev';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const upstream = new URL(url.pathname + url.search, ORIGIN);
    const response = await fetch(upstream, {
      method: request.method,
      headers: request.headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
    });
    const headers = new Headers(response.headers);
    const location = headers.get('location');
    if (location?.startsWith(ORIGIN)) headers.set('location', location.replace(ORIGIN, url.origin));
    return new Response(response.body, { status: response.status, headers });
  },
};
