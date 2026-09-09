/**
 * Facts the site is allowed to state, in one place.
 *
 * Everything here is either read from the repository at build time or is a
 * decision somebody made deliberately. Nothing on a page should hardcode a
 * version, a count or an address: the last time this site carried numbers as
 * literals it claimed 18 events, 17 cases and 10 categories while the pipeline
 * produced 7, 22 and 9.
 */
declare const __RIGORRUN_VERSION__: string;
declare const __RIGORRUN_MAIL__: boolean;
declare const __RIGORRUN_DOCS__: string;

/** Injected by astro.config.mjs from packages/cli/package.json. */
export const VERSION = __RIGORRUN_VERSION__;
export const RELEASE_LABEL = `Early Access · v${VERSION}`;

export const REPO_URL = 'https://github.com/Konuktor/rigorrun';
/**
 * Resolved at build time. Falls back to the Pages hostname while the custom
 * domain has no DNS record, so the nav never carries a link to nothing.
 */
export const DOCS_URL = __RIGORRUN_DOCS__;
export const NPM_URL = 'https://www.npmjs.com/package/rigorrun';

/**
 * Addresses forwarded by Cloudflare Email Routing on the rigorrun.xyz zone.
 *
 * `MAIL_LIVE` is resolved at build time by an MX lookup in astro.config.mjs. If
 * the zone cannot receive mail, these are never rendered and every contact
 * route falls back to the issue tracker — a security contact that bounces is
 * worse than none, because it converts somebody willing to report a problem
 * privately into somebody who believes they already have.
 *
 * `pnpm contact` reports the same thing without building.
 */
export const MAIL_LIVE = __RIGORRUN_MAIL__;
export const SECURITY_EMAIL = 'security@rigorrun.xyz';
export const CONTACT_EMAIL = 'hello@rigorrun.xyz';

/** Where to send somebody, given whether mail actually works. */
export const contactHref = (address: string): string =>
  MAIL_LIVE ? `mailto:${address}` : `${REPO_URL}/issues/new`;
export const contactLabel = (address: string): string =>
  MAIL_LIVE ? address : 'Open an issue on GitHub';
export const SECURITY_HREF = MAIL_LIVE
  ? `mailto:${SECURITY_EMAIL}`
  : `${REPO_URL}/security/advisories/new`;
export const SECURITY_LABEL = MAIL_LIVE ? SECURITY_EMAIL : 'a private security advisory on GitHub';

export const FOUNDER = 'Erbol Tahirov';
