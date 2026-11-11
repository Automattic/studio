import '@/lib/theme/tokens.css';
import '@/lib/theme/base.css';
import '@/index.css';
import { init as initSentry } from '@sentry/electron/renderer';
import { captureException } from '@studio/common/lib/error-reporting';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { applyUserPreferences } from '@/app/apply-user-preferences';
import { loadStartupRouter } from '@/app/load-startup-router';
import { StartupScreen } from '@/app/startup-screen';
import { persistPromise, queryClient } from '@/data/core';
import { createIpcConnector } from '@/data/core/connectors/ipc';

// Events go through the main process, which adds the release and the user.
initSentry();

async function bootstrap() {
	if ( /mac/i.test( navigator.platform ) ) {
		document.documentElement.dataset.nativeSidebar = '';
	}

	const connector = createIpcConnector();

	const root = createRoot( document.getElementById( 'root' )!, {
		// Errors an error boundary catches (the router's included) never reach Sentry's global handlers.
		onCaughtError: ( error, errorInfo ) => {
			captureException( error );
			console.error( error, errorInfo.componentStack );
		},
	} );
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
