import * as Sentry from '@sentry/electron/renderer';
import { startApp } from '@/app';
import { createIpcConnector } from '@/data/core/connectors/ipc';

// Events go through the main process, which adds the release and the user.
Sentry.init();

startApp( createIpcConnector(), {
	// Errors an error boundary catches never reach Sentry's global handlers.
	onCaughtError: ( error, errorInfo ) => {
		Sentry.captureException( error );
		console.error( error, errorInfo.componentStack );
	},
} );
