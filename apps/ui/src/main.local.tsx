import '@/lib/theme/tokens.css';
import '@/lib/theme/base.css';
import '@/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { applyUserPreferences } from '@/app/apply-user-preferences';
import { persistPromise } from '@/data/core';
import { createLocalConnector } from '@/data/core/connectors/local';

// Local entry point. Identical to `main.tsx` except it wires the HTTP/SSE local
// connector instead of the Electron IPC connector, so the same React app runs
// in a plain browser tab against the local server started by `studio ui`
// (`apps/local`, bundled into the Studio CLI).

async function bootstrap() {
	const connector = createLocalConnector( {
		apiBaseUrl: window.location.origin,
	} );

	await Promise.all( [ connector.init?.(), applyUserPreferences( connector ), persistPromise ] );

	createRoot( document.getElementById( 'root' )! ).render(
		<StrictMode>
			<App connector={ connector } />
		</StrictMode>
	);
}

void bootstrap();
