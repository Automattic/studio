import '@/lib/theme/tokens.css';
import '@/lib/theme/base.css';
import '@/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { applyUserPreferences } from '@/app/apply-user-preferences';
import { onCaughtError, setupBrowserErrorReporting } from '@/app/error-reporting';
import { loadStartupRouter } from '@/app/load-startup-router';
import { StartupScreen } from '@/app/startup-screen';
import { persistPromise, queryClient } from '@/data/core';
import { createLocalConnector } from '@/data/core/connectors/local';

// Local entry point. Identical to `main.tsx` except it wires the HTTP/SSE local
// connector instead of the Electron IPC connector, so the same React app runs
// in a plain browser tab against the local server started by `studio ui`
// (`apps/local`, bundled into the Studio CLI).

setupBrowserErrorReporting( 'studio-ui' );

async function bootstrap() {
	const connector = createLocalConnector( {
		apiBaseUrl: window.location.origin,
	} );

	const root = createRoot( document.getElementById( 'root' )!, { onCaughtError } );
	root.render( <StartupScreen /> );

	await Promise.all( [ connector.init?.(), applyUserPreferences( connector ), persistPromise ] );
	const router = await loadStartupRouter( connector, queryClient );

	root.render(
		<StrictMode>
			<App connector={ connector } router={ router } />
		</StrictMode>
	);
}

void bootstrap();
