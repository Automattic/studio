import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
	type AiConnection,
	type AiModelId,
	type AiProviderId,
	type ProviderConfigs,
	type ProviderId,
	type ProviderSites,
	type SitesProviderId,
} from '..';
import { defineProvider, defineServices } from '../types';
import type { AnthropicConfig } from '../anthropic/config';
import type { GeminiConfig } from '../gemini/config';
import type { GithubCopilotConfig } from '../github-copilot/config';
import type { OpenaiConfig } from '../openai/config';
import type { SpacefastConfig } from '../spacefast/config';
import type { Space } from '../spacefast/descriptor';
import type { WpcomConfig } from '../wpcom/config';
import type { SyncSite } from '../wpcom/sites/site';

// Checked by `npm run typecheck`: each `@ts-expect-error` marks a line typecheck must reject.

const configSchema = z.object( { apiKey: z.string() } );
const methods = [
	{ id: 'api-key', label: () => 'API key', kind: 'form', input: () => configSchema },
] as const;
const models = [ { id: 'sample-large', label: () => 'Sample Large' } ] as const;
const connection = {} as AiConnection;
const space = { id: 'space', name: 'Space', url: 'https://space.example' };
const sites = {
	pull: false,
	selective: false,
	content: 'static',
	newSite: 'create',
	intro: { title: () => 'Publish', description: () => 'Publish', learnMoreUrl: '' },
	describe: ( site: typeof space ) => ( {
		details: [ { title: 'Name', value: site.name } ],
		links: [],
	} ),
	issue: () => null,
	withDetails: < Connection >( connections: Connection[] ) => connections,
} as const;

const chat = defineProvider( {
	id: 'sample-chat',
	label: 'Sample',
	account: { configSchema, methods, describe: () => ( { method: 'api-key' } ) },
	ai: { models, defaultModel: 'sample-large' },
} );

const hosting = defineProvider( {
	id: 'sample-hosting',
	label: 'Sample',
	account: {
		configSchema,
		methods: [ { id: 'sign-in', label: () => 'Connect', kind: 'device' } ],
		describe: () => ( { method: 'sign-in' } ),
	},
	sites,
} );

const account = { connect: async () => ( { apiKey: 'key' } ) };
const signInAccount = { ...account, start: async () => ( { url: '', handoff: {} } ) };
const hostingSites = {
	list: async () => [ space ],
	create: async () => space,
	push: async () => undefined,
};

describe( 'the registration', () => {
	it( 'derives each provider’s types from its registered descriptor', () => {
		expectTypeOf<
			'wpcom' | 'anthropic' | 'openai' | 'gemini' | 'github-copilot' | 'spacefast'
		>().toExtend< ProviderId >();
		expectTypeOf< string >().not.toExtend< ProviderId >();
		expectTypeOf<
			'wpcom' | 'anthropic' | 'openai' | 'gemini' | 'github-copilot'
		>().toExtend< AiProviderId >();
		expectTypeOf< 'spacefast' >().not.toExtend< AiProviderId >();
		expectTypeOf< 'wpcom' | 'spacefast' >().toExtend< SitesProviderId >();
		expectTypeOf< 'anthropic' >().not.toExtend< SitesProviderId >();
		expectTypeOf< ProviderConfigs[ 'wpcom' ] >().toEqualTypeOf< WpcomConfig >();
		expectTypeOf< ProviderConfigs[ 'anthropic' ] >().toEqualTypeOf< AnthropicConfig >();
		expectTypeOf< ProviderConfigs[ 'openai' ] >().toEqualTypeOf< OpenaiConfig >();
		expectTypeOf< ProviderConfigs[ 'gemini' ] >().toEqualTypeOf< GeminiConfig >();
		expectTypeOf< ProviderConfigs[ 'github-copilot' ] >().toEqualTypeOf< GithubCopilotConfig >();
		expectTypeOf< ProviderConfigs[ 'spacefast' ] >().toEqualTypeOf< SpacefastConfig >();
		expectTypeOf< ProviderSites[ 'wpcom' ] >().toEqualTypeOf< SyncSite >();
		expectTypeOf< ProviderSites[ 'spacefast' ] >().toEqualTypeOf< Space >();
		expectTypeOf<
			| 'fast'
			| 'balanced'
			| 'strong'
			| 'claude-sonnet-5-5'
			| 'claude-opus-5-5'
			| 'gpt-6.1-terra'
			| 'gpt-6.1-sol'
			| 'gemini-3.8-flash'
			| 'gemini-4-argon'
		>().toExtend< AiModelId >();
		expectTypeOf< string >().not.toExtend< AiModelId >();
	} );
} );

describe( 'a descriptor', () => {
	it( 'offers only its own models', () => {
		defineProvider( {
			id: 'sample',
			label: 'Sample',
			account: {
				configSchema,
				methods,
				// @ts-expect-error A model the provider doesn't list.
				describe: () => ( { method: 'api-key', models: [ 'fast' ] } ),
			},
			ai: { models, defaultModel: 'sample-large' },
		} );
		defineProvider( {
			id: 'sample',
			label: 'Sample',
			account: { configSchema, methods, describe: () => ( { method: 'api-key' } ) },
			// @ts-expect-error A model the provider doesn't list.
			ai: { models, defaultModel: 'fast' },
		} );
	} );

	it( 'leaves the Studio sign-in to WordPress.com', () => {
		defineProvider( {
			id: 'sample',
			label: 'Sample',
			account: {
				configSchema,
				// @ts-expect-error The `redirect` kind is WordPress.com's.
				methods: [ { id: 'sign-in', label: () => 'Log in', kind: 'redirect' } ],
				describe: () => ( { method: 'sign-in' } ),
			},
		} );
	} );
} );

describe( 'services', () => {
	it( 'need every part their descriptor declares', () => {
		// @ts-expect-error Models need a model connection.
		defineServices( chat, { account } );
		// @ts-expect-error Models need a model connection.
		defineServices( chat, { account, ai: {} } );
		// @ts-expect-error A device sign-in needs `start`.
		defineServices( hosting, { account, sites: hostingSites } );
		for ( const kind of [ 'device', 'loopback' ] as const ) {
			const signInOrForm = defineProvider( {
				...chat,
				account: {
					...chat.account,
					methods: [ ...methods, { id: 'sign-in', label: () => 'Sign in', kind } ],
				},
			} );
			const ai = { model: async () => connection };
			// @ts-expect-error A sign-in needs `start`, whatever other methods there are.
			defineServices( signInOrForm, { account, ai } );
			defineServices( signInOrForm, { account: signInAccount, ai } );
		}
		const { push: _push, ...withoutPush } = hostingSites;
		// @ts-expect-error Remote sites need `push`.
		defineServices( hosting, { account: signInAccount, sites: withoutPush } );
		const { create: _create, ...withoutCreate } = hostingSites;
		// @ts-expect-error `newSite: 'create'` needs `create`.
		defineServices( hosting, { account: signInAccount, sites: withoutCreate } );
		const pulling = defineProvider( { ...hosting, sites: { ...sites, pull: true } } );
		// @ts-expect-error `pull: true` needs `pull`.
		defineServices( pulling, { account: signInAccount, sites: hostingSites } );

		expectTypeOf(
			defineServices( chat, { account, ai: { model: async () => connection } } ).id
		).toEqualTypeOf< 'sample-chat' >();
		defineServices( hosting, { account: signInAccount, sites: hostingSites } );
	} );

	it( 'offer nothing their descriptor doesn’t declare', () => {
		defineServices( hosting, {
			account: signInAccount,
			sites: hostingSites,
			// @ts-expect-error The descriptor offers no models.
			ai: { model: async () => connection },
		} );
		defineServices( chat, {
			account,
			ai: { model: async () => connection },
			// @ts-expect-error The descriptor has no remote sites.
			sites: hostingSites,
		} );
	} );

	it( 'connect only over the APIs Studio runs', () => {
		const model = { ...connection.model, api: 'mistral-conversations' as const };
		// @ts-expect-error Studio doesn't run `mistral-conversations`.
		const rejected: AiConnection = { ...connection, model };
		expectTypeOf( rejected ).toEqualTypeOf< AiConnection >();
	} );
} );
