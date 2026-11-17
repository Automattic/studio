import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConnectError } from '@studio/providers';
import { getProviderServices } from '@studio/providers/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	changeAiSettings,
	getAiTurnTracksProps,
	getModelFamily,
} from '@studio/common/lib/ai-provider-tracks';
import {
	connectProvider,
	disconnectProvider,
	persistSelectedAiProvider,
	setAiProvider,
} from '@studio/common/lib/ai-settings';
import { writeProviderConfig } from '@studio/common/lib/provider-config';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';

const anthropic = getProviderServices( 'anthropic' );
const API_KEY = 'sk-ant-api03-testkey-1234';

describe( 'AI provider Tracks props', () => {
	let configDir: string;
	let previousDevConfigDir: string | undefined;
	const record = vi.fn();

	const connectAnthropic = ( apiKey = API_KEY ) =>
		changeAiSettings(
			{ action: 'connect', provider: 'anthropic', method: 'api-key' },
			() => connectProvider( anthropic, 'api-key', { apiKey } ),
			record
		);

	beforeEach( () => {
		configDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-ai-provider-tracks-' ) );
		previousDevConfigDir = process.env.DEV_CONFIG_DIR;
		process.env.DEV_CONFIG_DIR = configDir;
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( { ok: true, status: 200 } ) );
		record.mockReset();
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
		if ( previousDevConfigDir === undefined ) {
			delete process.env.DEV_CONFIG_DIR;
		} else {
			process.env.DEV_CONFIG_DIR = previousDevConfigDir;
		}
		fs.rmSync( configDir, { recursive: true, force: true } );
	} );

	it( 'records a connection with its method, and never the credential', async () => {
		await connectAnthropic();

		expect( record ).toHaveBeenCalledExactlyOnceWith( TRACKS_EVENTS.SETTING_AI_PROVIDER_CHANGE, {
			action: 'connect',
			target_provider: 'anthropic',
			connection_method: 'api-key',
			success: true,
			// Nothing else was connected, so the new provider became the selected one.
			provider: 'anthropic',
			previous_provider: 'wpcom',
			surface: 'settings',
		} );
		expect( JSON.stringify( record.mock.calls ) ).not.toContain( 'testkey' );
	} );

	it( 'records a refused connection with the reason, and rethrows', async () => {
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( { ok: false, status: 401 } ) );

		await expect( connectAnthropic() ).rejects.toBeInstanceOf( ConnectError );

		expect( record ).toHaveBeenCalledExactlyOnceWith(
			TRACKS_EVENTS.SETTING_AI_PROVIDER_CHANGE,
			expect.objectContaining( {
				action: 'connect',
				target_provider: 'anthropic',
				connection_method: 'api-key',
				success: false,
				failure_reason: 'invalid',
				provider: 'wpcom',
			} )
		);
	} );

	it( 'reports a failure that is not the provider’s refusal as other', async () => {
		await expect(
			changeAiSettings(
				{ action: 'connect', provider: 'openai', method: 'chatgpt' },
				() => Promise.reject( new Error( 'socket hang up' ) ),
				record
			)
		).rejects.toThrow( 'socket hang up' );

		expect( record.mock.calls[ 0 ][ 1 ] ).toMatchObject( {
			connection_method: 'chatgpt',
			failure_reason: 'other',
		} );
	} );

	it( 'records a disconnection with the method it had, and the provider it fell back to', async () => {
		await connectAnthropic();
		record.mockReset();

		await changeAiSettings(
			{ action: 'disconnect', provider: 'anthropic' },
			() => disconnectProvider( anthropic ),
			record
		);

		expect( record.mock.calls[ 0 ][ 1 ] ).toMatchObject( {
			action: 'disconnect',
			target_provider: 'anthropic',
			connection_method: 'api-key',
			provider: 'wpcom',
			previous_provider: 'anthropic',
		} );
	} );

	it( 'records a switch, and nothing when the selection stays the same', async () => {
		await writeProviderConfig( 'anthropic', { method: 'setup-token', token: 'sk-ant-oat01-x' } );
		const select = ( run: () => Promise< unknown > ) =>
			changeAiSettings(
				{ action: 'select', provider: 'anthropic', surface: 'terminal' },
				async () => void ( await run() ),
				record
			);

		await select( () => setAiProvider( 'anthropic' ) );
		await select( () => persistSelectedAiProvider( 'anthropic' ) );

		expect( record ).toHaveBeenCalledExactlyOnceWith(
			TRACKS_EVENTS.SETTING_AI_PROVIDER_CHANGE,
			expect.objectContaining( {
				action: 'select',
				connection_method: 'setup-token',
				provider: 'anthropic',
				previous_provider: 'wpcom',
				surface: 'terminal',
			} )
		);
	} );

	it( 'tells a subscription from an API key on a turn', async () => {
		await writeProviderConfig( 'anthropic', { method: 'setup-token', token: 'sk-ant-oat01-x' } );

		await expect( getAiTurnTracksProps( 'anthropic', 'claude-opus-5-5' ) ).resolves.toEqual( {
			provider: 'anthropic',
			connection_method: 'setup-token',
			model: 'claude-opus-5-5',
			model_family: 'anthropic',
		} );
		// WordPress.com connects one way, so its method is known even without a stored sign-in.
		await expect( getAiTurnTracksProps( 'wpcom', 'balanced' ) ).resolves.toMatchObject( {
			connection_method: 'sign-in',
			model_family: 'studio',
		} );
	} );

	it( 'names whose model a provider serves', () => {
		expect( getModelFamily( 'github-copilot', 'gpt-6.1-terra' ) ).toBe( 'openai' );
		expect( getModelFamily( 'github-copilot', 'claude-sonnet-5-5' ) ).toBe( 'anthropic' );
		expect( getModelFamily( 'meta', 'muse-spark-1.3' ) ).toBe( 'meta' );
		expect( getModelFamily( 'openai', 'some-new-model' ) ).toBe( 'other' );
	} );
} );
