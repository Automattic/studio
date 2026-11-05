import { defineTool, READ_ONLY, REMOTE_CHANGE, textResult } from '@studio/agent/node';
import {
	authAnalyticsSchema,
	createAuthAttempt,
	createAuthAttemptStore,
	getAuthTracksProps,
} from '@studio/common/lib/auth-tracks';
import { Type } from 'typebox';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { getCliAuthenticationUrl, storeAuthToken } from 'cli/lib/wpcom-auth';
import type { AuthAttempt } from '@studio/common/lib/auth-tracks';
import type { TracksEventName, TracksProps } from '@studio/common/lib/record-tracks-event';

const analyticsFor = ( journeyId?: string ) =>
	authAnalyticsSchema.safeParse( {
		placement: 'mcp_library',
		intent: 'account',
		journey_id: journeyId,
	} ).data ?? ( { placement: 'mcp_library', intent: 'account' } as const );

async function record( event: TracksEventName, props: TracksProps ) {
	await recordTracksEvent( event, { ...props, ...getTracksOrigin() } ).catch( () => undefined );
}

const attemptProps = ( attempt: AuthAttempt ) => ( {
	...getAuthTracksProps( attempt ),
	account_type: undefined,
} );

// One store per MCP connection, just like the callback stores in the other hosts.
export function createLibraryAuthTools() {
	const attempts = createAuthAttemptStore();
	const start = async ( journeyId?: string ) => {
		const attempt = createAuthAttempt( 'mcp', false, analyticsFor( journeyId ) );
		attempts.add( attempt );
		await record( TRACKS_EVENTS.WPCOM_AUTH_STARTED, attemptProps( attempt ) );
		return attempt;
	};
	return [
		defineTool(
			'wpcom_login',
			"Returns WordPress.com's authorization page, or stores the token it showed.",
			{
				token: Type.Optional( Type.String() ),
				attemptId: Type.Optional( Type.String() ),
				journeyId: Type.Optional( Type.String() ),
				retry: Type.Optional( Type.Boolean() ),
			},
			async ( { token, attemptId, journeyId, retry } ) => {
				if ( ! token ) {
					const attempt = await start( journeyId );
					try {
						return {
							...textResult( 'Authorization page.' ),
							_meta: {
								url: await getCliAuthenticationUrl(),
								authAttemptId: attempt.auth_attempt_id,
							},
						};
					} catch ( error ) {
						attempts.take( attempt.auth_attempt_id );
						await record( TRACKS_EVENTS.WPCOM_AUTH_LAUNCH_FAILED, attemptProps( attempt ) );
						throw error;
					}
				}
				const attempt = retry ? await start( journeyId ) : attempts.take( attemptId );
				if ( retry && attempt ) attempts.take( attempt.auth_attempt_id );
				await storeAuthToken( token.trim(), attempt );
				return textResult( 'Logged in.' );
			},
			{ annotations: REMOTE_CHANGE }
		),
		defineTool(
			'wpcom_login_event',
			'Records a visible WordPress library login prompt or an observed browser handoff failure.',
			{
				event: Type.Enum( [ 'prompt_viewed', 'launch_failed' ] ),
				journeyId: Type.Optional( Type.String() ),
				attemptId: Type.Optional( Type.String() ),
			},
			async ( { event, journeyId, attemptId } ) => {
				if ( event === 'prompt_viewed' ) {
					await record( TRACKS_EVENTS.ACCOUNT_PROMPT_VIEWED, {
						source: 'mcp',
						...analyticsFor( journeyId ),
					} );
				} else {
					const attempt = attempts.take( attemptId );
					if ( attempt )
						await record( TRACKS_EVENTS.WPCOM_AUTH_LAUNCH_FAILED, attemptProps( attempt ) );
				}
				return textResult( 'Recorded.' );
			},
			{ annotations: READ_ONLY }
		),
	];
}
