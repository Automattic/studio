import crypto from 'crypto';
import { app, shell, type IpcMainInvokeEvent } from 'electron';
import fs from 'fs/promises';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { bumpStat, StatsGroup, StatsMetric } from 'src/lib/bump-stats';
import { getAuthenticationToken } from 'src/lib/oauth';
import { sanitizeUnstructuredData, sanitizeUserpath } from 'src/lib/sanitize-for-logging';
import { getLogsFilePath } from 'src/logging';
import {
	FEEDBACK_API_PATH,
	FEEDBACK_API_URL,
	LOG_TAIL_BYTES,
	feedbackSubmissionSchema,
	type FeedbackIdentity,
	type FeedbackResult,
	type FeedbackWirePayload,
} from 'src/modules/feedback/lib/feedback-schema';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';

export async function submitFeedback(
	_event: IpcMainInvokeEvent,
	input: unknown
): Promise< FeedbackResult > {
	const parsed = feedbackSubmissionSchema.safeParse( input );
	if ( ! parsed.success ) {
		return { success: false, error: 'validation' };
	}
	const { message, email, includeLogs, category } = parsed.data;

	const token = await getAuthenticationToken();
	const identity: FeedbackIdentity = token
		? { type: 'wpcom', wpcomUserId: token.id, email: token.email, displayName: token.displayName }
		: { type: 'anonymous', anonymousId: await getAnonymousId(), contactEmail: email };

	const payload: FeedbackWirePayload = {
		message,
		category,
		appVersion: app.getVersion(),
		platform: process.platform,
		electronVersion: process.versions.electron,
		osVersion: process.getSystemVersion?.(),
		identity,
	};

	if ( includeLogs ) {
		const logs = await readSanitizedLogTail();
		if ( logs ) {
			payload.logs = logs;
		}
	}

	try {
		if ( token ) {
			const wpcom = wpcomFactory( token.accessToken, wpcomXhrRequest );
			await wpcom.req.post( { path: FEEDBACK_API_PATH, apiNamespace: 'wpcom/v2', body: payload } );
		} else {
			const response = await fetch( FEEDBACK_API_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( payload ),
			} );
			if ( ! response.ok ) {
				bumpStat( StatsGroup.STUDIO_APP_FEEDBACK, StatsMetric.FAILURE );
				return { success: false, error: 'server' };
			}
		}
	} catch ( error ) {
		console.error( 'Failed to submit feedback:', error );
		bumpStat( StatsGroup.STUDIO_APP_FEEDBACK, StatsMetric.FAILURE );
		return { success: false, error: mapPostError( error ) };
	}

	bumpStat( StatsGroup.STUDIO_APP_FEEDBACK, StatsMetric.SUCCESS );
	return { success: true };
}

export async function openApplicationLogs(): Promise< void > {
	try {
		const logFilePath = getLogsFilePath();
		const err = await shell.openPath( logFilePath );
		if ( err ) {
			console.error( `Error opening logs file: ${ logFilePath } ${ err }` );
		}
	} catch ( error ) {
		console.error( 'Failed to open application logs:', error );
	}
}

// The feedback anonymous id is the same persistent per-installation UUID used for
// Sentry (generated at boot in index.ts). Reused here so anonymous reports can be
// correlated without introducing a second stored identifier.
async function getAnonymousId(): Promise< string > {
	const userData = await loadUserData();
	if ( userData.sentryUserId ) {
		return userData.sentryUserId;
	}

	await lockAppdata();
	try {
		const latest = await loadUserData();
		if ( latest.sentryUserId ) {
			return latest.sentryUserId;
		}
		const anonymousId = crypto.randomUUID();
		await saveUserData( { ...latest, sentryUserId: anonymousId } );
		return anonymousId;
	} finally {
		await unlockAppdata();
	}
}

async function readSanitizedLogTail(): Promise< string | undefined > {
	try {
		const raw = await fs.readFile( getLogsFilePath(), 'utf-8' );
		const tail = raw.length > LOG_TAIL_BYTES ? raw.slice( -LOG_TAIL_BYTES ) : raw;
		return sanitizeUserpath( sanitizeUnstructuredData( tail ) );
	} catch ( error ) {
		// A missing/unreadable log file must not fail the submission — just omit logs.
		console.error( 'Failed to read logs for feedback:', error );
		return undefined;
	}
}

function mapPostError( error: unknown ): 'network' | 'server' {
	if ( error && typeof error === 'object' && ( 'statusCode' in error || 'status' in error ) ) {
		return 'server';
	}
	return 'network';
}
