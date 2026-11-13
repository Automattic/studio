// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bindTool, createSiteNotes } from '@studio/agent/node';
import { getSharedConfigPath } from '@studio/common/lib/well-known-paths';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cliAgentHost } from 'cli/ai/host';
import { createLibraryTools } from 'cli/ai/runtimes/mcp/library';
import { runServedTool } from 'cli/ai/runtimes/mcp/served-tool';
import * as tracks from 'cli/lib/tracks';

vi.mock( 'cli/lib/daemon-client' );
vi.mock( 'cli/lib/i18n', () => ( { getAppLocale: async () => 'en' } ) );
const send = vi.fn( async ( _url: string ) => ( {} ) );
// WordPress.com's `/me`, which checks a pasted token.
const me = vi.fn( async () => ( {
	ok: true,
	json: async () => ( { ID: 123, email: 'private@example.com', display_name: 'Private name' } ),
} ) );
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let directory: string;
let tools: ReturnType< typeof createLibraryTools >;

beforeEach( async () => {
	directory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-mcp-auth-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', directory );
	vi.stubEnv( 'NODE_ENV', 'production' );
	vi.stubEnv( 'E2E', '' );
	vi.stubEnv( 'STUDIO_FORCE_CLI_TELEMETRY', '' );
	vi.stubEnv( 'STUDIO_TRACKS_ORIGIN', 'studio-mcp' );
	vi.stubEnv( 'STUDIO_MCP_CLIENT', 'audit-client' );
	vi.stubEnv( 'STUDIO_PLUGIN_ID', 'wp-studio@studio' );
	vi.stubEnv( 'STUDIO_PLUGIN_VERSION', '1.0.0' );
	vi.stubGlobal( '__ENABLE_CLI_TELEMETRY__', true );
	vi.stubGlobal( '__STUDIO_CLI_VERSION__', 'test' );
	vi.stubGlobal( 'fetch', ( url: string ) =>
		url.includes( '/rest/v1.1/me' ) ? me() : send( url )
	);
	send.mockClear();
	me.mockClear();
	tools = createLibraryTools( 'ui://studio/library.html' );
} );

afterEach( async () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.useRealTimers();
	await fs.rm( directory, { force: true, recursive: true } );
} );

async function call( name: string, args: Record< string, unknown > = {}, served = tools ) {
	const definition = served.find( ( entry ) => entry.tool.name === name )!;
	return runServedTool( cliAgentHost, bindTool( definition.tool, cliAgentHost ), args, {
		siteNotes: createSiteNotes( cliAgentHost ),
	} );
}

function events() {
	return send.mock.calls.map( ( [ url ] ) => Object.fromEntries( new URL( url ).searchParams ) );
}

it( 'joins visible prompt, explicit login and token outcome with existing anonymous Tracks props', async () => {
	const journeyId = crypto.randomUUID();
	await call( 'wpcom_login_event', { event: 'prompt_viewed', journeyId } );
	const start = await call( 'wpcom_login', { journeyId } );
	const attemptId = start._meta?.authAttemptId;
	expect( attemptId ).toMatch( uuid );
	expect( String( start._meta?.url ) ).toContain( 'copy-oauth-token' );
	expect( await call( 'wpcom_login', { token: 'private-token', attemptId } ) ).toMatchObject( {
		isError: false,
	} );
	expect( events().map( ( event ) => event._en ) ).toEqual( [
		'studio_account_prompt_viewed',
		'studio_wpcom_auth_started',
		'studio_wpcom_auth',
	] );
	const shared = JSON.parse( await fs.readFile( getSharedConfigPath(), 'utf8' ) );
	expect( shared.authToken.accessToken ).toBe( 'private-token' );
	for ( const event of events() ) {
		expect( event ).toMatchObject( {
			_ut: 'anon',
			_ui: shared.analyticsInstallId,
			channel: 'studio-mcp',
			source: 'mcp',
			placement: 'mcp_library',
			intent: 'account',
			journey_id: journeyId,
			mcp_client: 'audit-client',
			plugin: 'wp-studio@studio',
			plugin_version: '1.0.0',
		} );
		expect( event ).not.toHaveProperty( 'account_type' );
	}
	expect( events()[ 1 ].auth_attempt_id ).toBe( attemptId );
	expect( events()[ 2 ] ).toMatchObject( {
		auth_attempt_id: attemptId,
		auth_flow: 'login',
		success: 'true',
	} );
	expect( JSON.stringify( events() ) ).not.toMatch(
		/private-token|private@example.com|Private name|site_id|completion_kind/
	);
	for ( const name of [ 'wpcom_login', 'wpcom_login_event' ] ) {
		expect( tools.find( ( entry ) => entry.tool.name === name )?.listing._meta ).toMatchObject( {
			ui: { visibility: [ 'app' ] },
		} );
	}
} );

it( 'records a failure and gives an explicit token retry its own attempt', async () => {
	const journeyId = crypto.randomUUID();
	const start = await call( 'wpcom_login', { journeyId } );
	const attemptId = start._meta?.authAttemptId;
	me.mockRejectedValueOnce( new Error( 'private-token rejected' ) );
	expect( await call( 'wpcom_login', { token: 'private-token', attemptId } ) ).toMatchObject( {
		isError: true,
	} );
	expect( events()[ 1 ] ).toMatchObject( {
		auth_attempt_id: attemptId,
		success: 'false',
		failure_reason: 'profile_fetch_failed',
	} );
	expect(
		await call( 'wpcom_login', {
			token: 'another-private-token',
			retry: true,
			journeyId,
			attemptId,
		} )
	).toMatchObject( { isError: false } );
	expect( events().map( ( event ) => event._en ) ).toEqual( [
		'studio_wpcom_auth_started',
		'studio_wpcom_auth',
		'studio_wpcom_auth_started',
		'studio_wpcom_auth',
	] );
	expect( events()[ 2 ].auth_attempt_id ).toMatch( uuid );
	expect( events()[ 2 ].auth_attempt_id ).not.toBe( attemptId );
	expect( events()[ 3 ].auth_attempt_id ).toBe( events()[ 2 ].auth_attempt_id );
	expect( events()[ 3 ].journey_id ).toBe( journeyId );
	expect( JSON.stringify( events() ) ).not.toContain( 'private-token' );
} );

it( 'matches parallel library views by ID and consumes each attempt once', async () => {
	const first = await call( 'wpcom_login', { journeyId: crypto.randomUUID() } );
	const second = await call( 'wpcom_login', { journeyId: crypto.randomUUID() } );
	const firstId = first._meta?.authAttemptId;
	const secondId = second._meta?.authAttemptId;
	await call( 'wpcom_login', { token: 'token', attemptId: firstId } );
	await call( 'wpcom_login', { token: 'token', attemptId: secondId } );
	await call( 'wpcom_login', { token: 'token', attemptId: firstId } );
	expect(
		events()
			.slice( 2 )
			.map( ( event ) => event.auth_attempt_id )
	).toEqual( [ firstId, secondId, undefined ] );
	expect( events().at( -1 )?.source ).toBe( 'unknown' );
} );

it.each( [ 'missing', 'expired', 'restarted' ] )(
	'keeps %s context unknown without preventing token storage',
	async ( kind ) => {
		const start = await call( 'wpcom_login', { journeyId: crypto.randomUUID() } );
		if ( kind === 'expired' )
			vi.spyOn( Date, 'now' ).mockReturnValue( Date.now() + 15 * 60 * 1000 + 1 );
		const served = kind === 'restarted' ? createLibraryTools( 'ui://studio/library.html' ) : tools;
		await call(
			'wpcom_login',
			{
				token: 'token',
				attemptId: kind === 'missing' ? '/private/caller-id' : start._meta?.authAttemptId,
			},
			served
		);
		expect( events().at( -1 ) ).toMatchObject( { source: 'unknown', success: 'true' } );
		expect( events().at( -1 ) ).not.toHaveProperty( 'auth_attempt_id' );
		expect( events().at( -1 ) ).not.toHaveProperty( 'journey_id' );
	}
);

it( 'leaves a missing return unclassified and records only observed handoff failure', async () => {
	await call( 'wpcom_login' );
	expect( events().map( ( event ) => event._en ) ).toEqual( [ 'studio_wpcom_auth_started' ] );
	const another = await call( 'wpcom_login' );
	await call( 'wpcom_login_event', {
		event: 'launch_failed',
		attemptId: another._meta?.authAttemptId,
	} );
	expect( events().map( ( event ) => event._en ) ).toEqual( [
		'studio_wpcom_auth_started',
		'studio_wpcom_auth_started',
		'studio_wpcom_auth_launch_failed',
	] );
	expect( events().at( -1 )?.auth_attempt_id ).toBe( another._meta?.authAttemptId );
	expect( events().some( ( event ) => event._en === 'studio_wpcom_auth_cancelled' ) ).toBe( false );
} );

it( 'drops invalid attribution and never lets telemetry errors fail authentication', async () => {
	vi.spyOn( tracks, 'recordTracksEvent' ).mockRejectedValue( new Error( 'Telemetry unavailable' ) );
	expect(
		await call( 'wpcom_login_event', { event: 'prompt_viewed', journeyId: 'private@example.com' } )
	).toMatchObject( { isError: false } );
	const start = await call( 'wpcom_login', { journeyId: '/private/site' } );
	expect( start.isError ).toBe( false );
	expect(
		await call( 'wpcom_login', { token: 'private-token', attemptId: start._meta?.authAttemptId } )
	).toMatchObject( { isError: false } );
	me.mockRejectedValueOnce( new Error( 'Rejected' ) );
	expect( await call( 'wpcom_login', { token: 'bad' } ) ).toMatchObject( { isError: true } );
} );

it.each( [ 'opt-out', 'build-disabled' ] )(
	'honors %s for prompt, starts, outcomes and handoff failures',
	async ( gate ) => {
		if ( gate === 'opt-out' )
			await fs.writeFile(
				getSharedConfigPath(),
				JSON.stringify( { version: 1, analyticsOptOut: true } )
			);
		if ( gate === 'build-disabled' ) vi.stubGlobal( '__ENABLE_CLI_TELEMETRY__', false );
		await call( 'wpcom_login_event', { event: 'prompt_viewed', journeyId: crypto.randomUUID() } );
		const first = await call( 'wpcom_login' );
		await call( 'wpcom_login', { token: 'private-token', attemptId: first._meta?.authAttemptId } );
		const second = await call( 'wpcom_login' );
		await call( 'wpcom_login_event', {
			event: 'launch_failed',
			attemptId: second._meta?.authAttemptId,
		} );
		expect( send ).not.toHaveBeenCalled();
	}
);
