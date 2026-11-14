import * as Sentry from '@sentry/node';
import { SENTRY_DSN } from '@studio/common/constants';
import { readSentryUserId } from '@studio/common/lib/app-config';
import {
	captureException,
	HOST_REPORTS_CLI_ERRORS_ENV,
	prepareErrorEvent,
	setErrorReporter,
} from '@studio/common/lib/error-reporting';
import { getSentryReleaseInfo } from '@studio/common/lib/sentry-release';
import type { ErrorEvent } from '@sentry/node';

const hostReportsFailures = process.env[ HOST_REPORTS_CLI_ERRORS_ENV ] === '1';

function isCrash( event: ErrorEvent ): boolean {
	return !! event.exception?.values?.some( ( value ) => value.mechanism?.handled === false );
}

/**
 * Reports to Sentry, in the terminal, under `studio ui` and `studio mcp`, and in the commands
 * the Desktop app starts. There, the app reports how a command fails, so only what it can't see
 * is reported here: errors shared code reports, like the agent's.
 */
export function setupErrorReporting(): void {
	const { sentryRelease, isDevEnvironment } = getSentryReleaseInfo( __STUDIO_CLI_VERSION__ );
	const sentryUserId = readSentryUserId();
	Sentry.init( {
		dsn: SENTRY_DSN,
		enabled: __ENABLE_CLI_TELEMETRY__ && ! isDevEnvironment,
		release: sentryRelease,
		environment: 'production',
		initialScope: {
			tags: { surface: 'cli', distribution: __IS_PACKAGED_FOR_NPM__ ? 'npm' : 'app' },
			user: sentryUserId ? { id: sentryUserId } : undefined,
		},
		// Its module-load hooks only serve tracing, which the CLI doesn't use.
		enableRuntimeChannelInjection: false,
		beforeSend: ( event, hint ) =>
			hostReportsFailures && isCrash( event ) ? null : prepareErrorEvent( event, hint ),
	} );
	setErrorReporter( Sentry.captureException );
}

/** Reports why a command failed, unless the app that started it does. */
export function reportCommandFailure( error: Error ): void {
	if ( ! hostReportsFailures ) {
		captureException( error );
	}
}
