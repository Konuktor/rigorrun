import { defineConfig } from 'vite';
import { sharedConfig } from '../../vite.shared.ts';

// Served from a domain root, like the other apps: a relative base would make a
// deep link request its assets from a nested path the SPA fallback answers
// with index.html, and the app would never boot.
export default defineConfig({ ...sharedConfig(), base: '/' });
