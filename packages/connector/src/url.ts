/**
 * Where a remote connector may point.
 *
 * Shared by every connector that opens a socket, because the shapes worth
 * refusing are the same whichever protocol is on top of it.
 */
/**
 * Hosts a remote connector may point at.
 *
 * Unlike an agent endpoint, a system under test is frequently on a private
 * network on purpose — a staging box, a service in a cluster. So this cannot
 * simply refuse private ranges the way `assertSafeAgentUrl` does. What it can
 * do is refuse the shapes that are never legitimate and are how SSRF is
 * actually done: a non-HTTP scheme, credentials smuggled into the URL, and the
 * cloud metadata addresses, which no customer's system is ever hosted on
 * and which are the single highest-value target on a machine running CI.
 */
const METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
  'fd00:ec2::254',
]);

export function assertSafeSystemUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`That is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`A system URL must be http or https, got ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error(
      'A system URL must not embed credentials. Put them in headers, which stay in the runner.',
    );
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (METADATA_HOSTS.has(host)) {
    throw new Error(`Refusing to connect to the cloud metadata address ${host}.`);
  }
  return url;
}

/**
 * Rejects a stdio configuration that did not come from a person.
 *
 * Cheap, and it is the check that would have to fail for a malicious benchmark
 * to run a command. Shell metacharacters in the *command* are the tell: a real
 * executable path does not contain them, and their presence means somebody is
 * trying to make one string become two.
 */
