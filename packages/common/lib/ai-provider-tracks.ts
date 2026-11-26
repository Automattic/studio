import { ConnectError, getConnectMethod, getProvider, type ProviderId } from '@studio/providers';
import {
	describeAccount,
	readAiSettings,
	type AiSettings,
	type ProviderAccount,
} from './ai-settings';
import { readProviderConfig } from './provider-config';
import { TRACKS_EVENTS, type TracksEventName, type TracksProps } from './record-tracks-event';

type RecordTracksEvent = ( event: TracksEventName, props: TracksProps ) => unknown;

export type AiSettingsChange = {
	action: 'connect' | 'disconnect' | 'select';
	provider: ProviderId;
	// The method a connection uses; others report the account's own.
	method?: string;
	// Where the change was made: Settings in the apps, a CLI command, or an app's chat run that
	// fell back to another provider.
	surface?: 'settings' | 'terminal' | 'chat';
};

function getConnectFailureReason( error: unknown ): ConnectError[ 'reason' ] | 'other' {
	return error instanceof ConnectError ? error.reason : 'other';
}

function accountMethod( settings: AiSettings, provider: ProviderId ): string | undefined {
	const account = settings.accounts[ provider ];
	return account.connected ? account.method : undefined;
}

// Undefined when the settings can't be read: the change still runs, unrecorded.
async function readSettings(): Promise< AiSettings | undefined > {
	try {
		return await readAiSettings();
	} catch {
		return undefined;
	}
}

async function record( recordEvent: RecordTracksEvent, props: TracksProps ): Promise< void > {
	try {
		await recordEvent( TRACKS_EVENTS.SETTING_AI_PROVIDER_CHANGE, props );
	} catch {
		// Analytics must never fail the change.
	}
}

/**
 * Runs a change to the AI settings and records it as `studio_setting_ai_provider_change`, so the
 * event reads the same from every host: a connection, disconnection or selection that changed
 * something, or a connection the provider refused. Credentials and account details are never sent.
 * A change that returns nothing has the settings read back after it.
 */
export async function changeAiSettings< Result extends AiSettings | void >(
	change: AiSettingsChange,
	run: () => Promise< Result >,
	recordEvent: RecordTracksEvent
): Promise< Result > {
	const previous = await readSettings();
	if ( ! previous ) {
		return run();
	}
	const props = {
		action: change.action,
		target_provider: change.provider,
		previous_provider: previous.provider,
		surface: change.surface ?? 'settings',
	};
	let result: Result;
	try {
		result = await run();
	} catch ( error ) {
		if ( change.action === 'connect' ) {
			await record( recordEvent, {
				...props,
				provider: previous.provider,
				connection_method: getConnectMethod( change.provider, change.method ).id,
				success: false,
				failure_reason: getConnectFailureReason( error ),
			} );
		}
		throw error;
	}
	const next = result || ( await readSettings() );
	if ( next && JSON.stringify( previous ) !== JSON.stringify( next ) ) {
		await record( recordEvent, {
			...props,
			provider: next.provider,
			connection_method: accountMethod(
				change.action === 'disconnect' ? previous : next,
				change.provider
			),
			success: true,
		} );
	}
	return result;
}

/**
 * What the Studio Code chat events say about the provider and model a turn runs on. The method
 * tells an API key from a subscription; `model_family` is whose model it is, which differs from
 * the provider when one serves another's models, such as GitHub Copilot.
 */
export async function getAiTurnTracksProps(
	provider: ProviderId,
	model: string
): Promise< TracksProps > {
	let account: ProviderAccount = { connected: false };
	try {
		account = describeAccount( provider, await readProviderConfig( provider ) );
	} catch {
		// The props still name the provider and model.
	}
	const methods = getProvider( provider ).account?.methods;
	// The CLI's inline WordPress.com token isn't stored, but WordPress.com connects one way.
	const fallback = methods?.length === 1 ? methods[ 0 ].id : undefined;
	return {
		provider,
		connection_method: account.connected ? account.method : fallback,
		// Analytics never name a local model: the user names it.
		...( getProvider( provider ).ai?.local
			? { model: 'local-model', model_family: provider }
			: { model, model_family: getModelFamily( provider, model ) } ),
	};
}

const MODEL_FAMILIES: [ prefix: string, family: string ][] = [
	[ 'claude-', 'anthropic' ],
	[ 'gpt-', 'openai' ],
	[ 'gemini-', 'gemini' ],
	[ 'grok-', 'xai' ],
	[ 'muse-', 'meta' ],
];

// WordPress.com's tiers pick their model on the server, so they are `studio`.
function getModelFamily( provider: ProviderId, model: string ): string {
	if ( provider === 'wpcom' ) {
		return 'studio';
	}
	return MODEL_FAMILIES.find( ( [ prefix ] ) => model.startsWith( prefix ) )?.[ 1 ] ?? 'other';
}
