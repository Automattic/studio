import { z } from 'zod';
import type { TracksAuthSource, TracksProps } from './record-tracks-event';

export const authSourceSchema = z.enum( [
	'onboarding',
	'sync_tab',
	'previews_tab',
	'assistant_tab',
	'overview_tab',
	'settings',
	'top_bar',
	'site_header',
	'add_site',
	'cli',
	'unknown',
] );

export const authAnalyticsSchema = z.object( {
	placement: z.enum( [
		'welcome',
		'account_menu',
		'share',
		'publish',
		'add_site_connect',
		'settings_account',
		'settings_ai',
		'settings_usage',
		'settings_sharing',
		'annotation',
		'cli',
		'unknown',
	] ),
	intent: z.enum( [
		'onboarding',
		'account',
		'build',
		'annotate',
		'share',
		'publish',
		'connect_site',
		'usage',
	] ),
	journey_id: z.string().uuid().optional(),
	journey_started_at: z.number().int().nonnegative().max( Number.MAX_SAFE_INTEGER ).optional(),
} );

export type AuthAnalytics = z.infer< typeof authAnalyticsSchema >;

export interface AuthAttempt {
	auth_attempt_id: string;
	source: TracksAuthSource;
	account_type: 'new' | 'existing';
	auth_flow: 'signup' | 'login';
	analytics?: AuthAnalytics;
}

export function createAuthAttempt(
	source: TracksAuthSource,
	signup: boolean,
	analytics?: AuthAnalytics
): AuthAttempt {
	return {
		auth_attempt_id: crypto.randomUUID(),
		source: authSourceSchema.catch( 'unknown' ).parse( source ),
		account_type: signup ? 'new' : 'existing',
		auth_flow: signup ? 'signup' : 'login',
		analytics: authAnalyticsSchema.safeParse( analytics ).data,
	};
}

export function getAuthTracksProps( attempt?: AuthAttempt ): TracksProps {
	return attempt
		? {
				source: attempt.source,
				account_type: attempt.account_type,
				auth_flow: attempt.auth_flow,
				auth_attempt_id: attempt.auth_attempt_id,
				...attempt.analytics,
		  }
		: { source: 'unknown' };
}

// Callback state is opaque. Never attribute a return to the last tab somebody opened.
export function createAuthAttemptStore() {
	const pending = new Map< string, { attempt: AuthAttempt; startedAt: number } >();
	const ttl = 15 * 60 * 1000;
	return {
		add( attempt: AuthAttempt ) {
			for ( const [ id, context ] of pending ) {
				if ( Date.now() - context.startedAt > ttl ) pending.delete( id );
			}
			if ( pending.size >= 100 ) pending.delete( pending.keys().next().value! );
			pending.set( attempt.auth_attempt_id, { attempt, startedAt: Date.now() } );
		},
		take( id?: string ): AuthAttempt | undefined {
			if ( ! id ) return;
			const context = pending.get( id );
			pending.delete( id );
			return context && Date.now() - context.startedAt <= ttl ? context.attempt : undefined;
		},
		clear() {
			pending.clear();
		},
	};
}

export const onboardingAnalyticsSchema = z.object( {
	completion_path: z.enum( [ 'authenticated_continue', 'continue_without_account', 'dismissed' ] ),
	journey_id: z.string().uuid().optional(),
} );
export type OnboardingAnalytics = z.infer< typeof onboardingAnalyticsSchema >;

export type AccountJourneyCompletion =
	| { completion_kind: 'ai_response' | 'ai_edit'; turn_id: string }
	| { completion_kind: 'preview_create' | 'preview_update' | 'sync_push' | 'sync_pull' };
