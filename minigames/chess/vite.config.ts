import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served from a subpath of act.gormadatyan.xyz (see deploy/nginx). index.html
// references /knight-logo.png absolutely and Vite emits /assets/*, so without
// `base` every asset 404s under /play/chess/.
//
// Routing itself is query-string only (?invite, ?join=, ?play=, ?watch=,
// ?history=, ?local=1) off window.location.pathname, so the app is
// subpath-safe once the asset base is right — no router basename needed.
// https://vite.dev/config/
export default defineConfig({
	base: '/play/chess/',
	plugins: [react()]
});
