import { startApp } from '@/app';
import { createHostedConnector } from '@/data/core/connectors/hosted';

// Web entry point. Identical to `main.tsx` except it wires the HTTP/SSE hosted
// connector instead of the Electron IPC connector, so the same React app runs
// in a plain browser tab against the Studio hosted backend (`apps/hosted`).

function getDefaultApiBaseUrl(): string {
	// Production builds are served by the Studio hosted backend itself, so the API is
	// same-origin. The Vite dev server (:5300) is a separate origin and targets
	// the backend's default port instead.
	return import.meta.env.DEV ? 'http://localhost:8088' : window.location.origin;
}

startApp(
	createHostedConnector( {
		apiBaseUrl: import.meta.env.VITE_STUDIO_API_URL ?? getDefaultApiBaseUrl(),
	} )
);
