import '@/theme/tokens.css';
import '@/index.css';
import { init as initSentry } from '@sentry/electron/renderer';
import { captureException } from '@studio/common/lib/error-reporting';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { persistPromise } from '@/data/core';
import { createIpcConnector } from '@/data/core/connectors/ipc';
import { applyUserPreferences } from '@/lib/apply-user-preferences';

// Events go through the main process, which adds the release and the user.
initSentry();

async function bootstrap() {
	const connector = createIpcConnector();

	await Promise.all( [ connector.init?.(), applyUserPreferences( connector ), persistPromise ] );

	createRoot( document.getElementById( 'root' )!, {
		// Errors an error boundary catches (the router's included) never reach Sentry's global handlers.
		onCaughtError: ( error, errorInfo ) => {
			captureException( error );
			console.error( error, errorInfo.componentStack );
		},
	} ).render(
		<StrictMode>
			<App connector={ connector } />
		</StrictMode>
	);
}

void bootstrap();
