import { defineConfig } from 'vite';
import { sharedConfig } from '../../vite.shared.ts';

// Served from a domain root. A relative base would make a deep link such as
// /customers/CUST-2016 request its assets from /customers/assets/…, which the
// SPA fallback answers with index.html — the app then never boots.
export default defineConfig({ ...sharedConfig(), base: '/' });
