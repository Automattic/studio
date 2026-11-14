import { captureException as captureSentryException, init } from '@sentry/browser';
import { SENTRY_DSN } from '@studio/common/constants';
import {
	captureException,
	prepareErrorEvent,
	setErrorReporter,
} from '@studio/common/lib/error-reporting';
import type { ErrorInfo } from 'react';

/** Reports to Sentry from the `studio ui` and web pages. The Electron renderer reports through the app. */
export function setupBrowserErrorReporting( surface: 'studio-ui' | 'web' ): void {
	if ( ! __SENTRY_RELEASE__ || ! import.meta.env.PROD ) {
		return;
	}
	init( {
		dsn: SENTRY_DSN,
		release: __SENTRY_RELEASE__,
		environment: 'production',
		initialScope: { tags: { surface } },
		beforeSend: prepareErrorEvent,
	} );
	setErrorReporter( captureSentryException );
}

// For `createRoot`: errors an error boundary catches (the router's included) never reach Sentry's
// global handlers.
export function onCaughtError( error: unknown, errorInfo: ErrorInfo ): void {
	captureException( error );
	console.error( error, errorInfo.componentStack );
}
