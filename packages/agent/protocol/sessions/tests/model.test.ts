import { describe, expect, it } from 'vitest';
import {
	getEffectiveSessionProvider,
	resolveSessionModelForProvider,
} from '@studio/agent/protocol/sessions/model';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { AiSettings } from '@studio/common/lib/ai-settings';

const settings = ( provider: AiSettings[ 'provider' ], connected: string[] ): AiSettings => ( {
	provider,
	accounts: {
		wpcom: connected.includes( 'wpcom' )
			? { connected: true, method: 'sign-in' }
			: { connected: false },
		anthropic: connected.includes( 'anthropic' )
			? { connected: true, method: 'api-key' }
			: { connected: false },
		openai: connected.includes( 'openai' )
			? { connected: true, method: 'chatgpt' }
			: { connected: false },
		gemini: { connected: false },
		'github-copilot': { connected: false },
		meta: { connected: false },
		xai: { connected: false },
		spacefast: { connected: false },
		'local-llm': connected.includes( 'local-llm' )
			? { connected: true, method: 'server', model: 'local-llm/qwen3:0.6b' }
			: { connected: false },
	},
	imageProviders: [],
	imageProvider: null,
} );

describe( 'getEffectiveSessionProvider', () => {
	it( 'runs on the selected provider, or the first connected one, WordPress.com first', () => {
		expect( getEffectiveSessionProvider( [], settings( 'openai', [ 'openai', 'wpcom' ] ) ) ).toBe(
			'openai'
		);
		expect(
			getEffectiveSessionProvider( [], settings( 'wpcom', [ 'openai', 'anthropic' ] ) )
		).toBe( 'anthropic' );
		expect(
			getEffectiveSessionProvider( [], settings( 'openai', [ 'wpcom', 'anthropic' ] ) )
		).toBe( 'wpcom' );
		expect( getEffectiveSessionProvider( [], settings( 'anthropic', [] ) ) ).toBe( 'wpcom' );
	} );
} );

describe( 'resolveSessionModelForProvider', () => {
	const recorded = ( model: string ) =>
		[
			{ type: 'custom', customType: 'studio.session_context', data: { model } },
		] as unknown as SessionEntry[];

	it( 'starts a chat on a local server on the model its account proposed', () => {
		const connected = settings( 'local-llm', [ 'local-llm' ] );

		expect( resolveSessionModelForProvider( [], 'local-llm', { settings: connected } ) ).toBe(
			'local-llm/qwen3:0.6b'
		);
	} );

	it( 'keeps the local model a chat recorded, which no other provider serves', () => {
		const connected = settings( 'local-llm', [ 'local-llm', 'wpcom' ] );
		const entries = recorded( 'local-llm/llama3.2:1b' );

		expect( resolveSessionModelForProvider( entries, 'local-llm', { settings: connected } ) ).toBe(
			'local-llm/llama3.2:1b'
		);
		expect( resolveSessionModelForProvider( entries, 'wpcom', { settings: connected } ) ).toBe(
			'fast'
		);
	} );
} );
