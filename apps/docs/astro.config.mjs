// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

/**
 * docs.rigorrun.xyz.
 *
 * The documentation used to be a directory of markdown files on GitHub, linked
 * from the site as "Docs". That is a reasonable place to keep documentation and
 * a poor place to read it: no search, no ordering, no next-page, and every link
 * an absolute URL into a branch.
 *
 * Starlight because it is Astro, so the docs and the site share one token file
 * and one pair of typefaces rather than looking like two companies; because its
 * search is Pagefind, which is built at build time and needs no service; and
 * because it produces static files that Cloudflare Pages serves directly.
 */
export default defineConfig({
  site: 'https://docs.rigorrun.xyz',
  integrations: [
    starlight({
      title: 'RigorRun',
      description:
        'Documentation for RigorRun — acceptance testing for AI agents that take real actions.',
      logo: { src: './src/assets/mark.svg', replacesTitle: false },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/docs.css'],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/Konuktor/rigorrun' },
      ],
      editLink: {
        baseUrl: 'https://github.com/Konuktor/rigorrun/edit/master/apps/docs/',
      },
      lastUpdated: true,
      credits: false,
      components: {
        // The site's own footer note, so a reader always knows where the docs
        // sit relative to the product.
        Footer: './src/components/Footer.astro',
      },
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { label: 'What RigorRun is', slug: 'start/what-it-is' },
            { label: 'Install and run', slug: 'start/install' },
            { label: 'Your first project', slug: 'start/first-project' },
            { label: 'Your first agent run', slug: 'start/first-run' },
            { label: 'Gate a build', slug: 'start/ci-gate' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Projects and workflows', slug: 'concepts/projects' },
            { label: 'Contracts and rules', slug: 'concepts/contracts' },
            { label: 'Cases and checks', slug: 'concepts/cases' },
            { label: 'Verification strength', slug: 'concepts/verification-strength' },
            { label: 'Isolation', slug: 'concepts/isolation' },
          ],
        },
        {
          label: 'Connect a system',
          items: [
            { label: 'Choosing a connection', slug: 'systems/choosing' },
            { label: 'MCP server', slug: 'systems/mcp' },
            { label: 'HTTP API from OpenAPI', slug: 'systems/openapi' },
            { label: 'Web application', slug: 'systems/browser' },
            { label: 'Credentials', slug: 'systems/credentials' },
          ],
        },
        {
          label: 'Connect an agent',
          items: [
            { label: 'How agents are driven', slug: 'agents/protocol' },
            { label: 'An HTTP agent', slug: 'agents/http' },
            { label: 'An agent you drive', slug: 'agents/driven' },
          ],
        },
        {
          label: 'CLI',
          items: [
            { label: 'Commands', slug: 'cli/commands' },
            { label: 'Exit codes', slug: 'cli/exit-codes' },
            { label: 'rigorrun verify', slug: 'cli/verify' },
          ],
        },
        {
          label: 'Trust',
          items: [
            { label: 'Local-first architecture', slug: 'trust/local-first' },
            { label: 'Security', slug: 'trust/security' },
            { label: 'Limitations', slug: 'trust/limitations' },
            { label: 'Evidence methodology', slug: 'trust/evidence' },
          ],
        },
        { label: 'Troubleshooting', slug: 'troubleshooting' },
      ],
    }),
  ],
});
