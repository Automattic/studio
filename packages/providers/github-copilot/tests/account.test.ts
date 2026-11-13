import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectError, NotConnectedError } from '../../errors';
import { githubCopilotAccount } from '../account';
import { githubCopilotAi } from '../ai';
import type { GithubCopilotConfig } from '../config';

const json = ( status: number, body: unknown = {} ) =>
	new Response( JSON.stringify( body ), { status } );

const copilotToken = 'tid=1;exp=2;proxy-ep=proxy.business.githubcopilot.com;';

const config = ( expiresIn: number, models?: string[] ): GithubCopilotConfig => ( {
	method: 'github',
	githubToken: 'gho_1',
	copilotToken,
	copilotTokenExpiresAt: Date.now() + expiresIn,
	models: models ?? [ 'claude-sonnet-5-5' ],
} );

const handoff = {
	deviceCode: 'device',
	interval: '0.001',
	expiresAt: String( Date.now() + 60_000 ),
};

// What the plan lists: a model it runs, one it has to turn on, and one it doesn't include.
const planModels = {
	data: [
		{ id: 'claude-sonnet-5.5', policy: { state: 'enabled' } },
		{ id: 'gpt-6.1-terra', policy: { state: 'unconfigured' } },
		{ id: 'gemini-4-argon', policy: { state: 'disabled' } },
	],
};

describe( 'github-copilot account', () => {
	const fetchMock = vi.fn();
	const respond = ( routes: Record< string, () => Response > ) =>
		fetchMock.mockImplementation( async ( url: string ) => {
			const route = Object.keys( routes ).find( ( path ) => url.endsWith( path ) );
			return route ? routes[ route ]() : json( 200 );
		} );

	beforeEach( () => {
		vi.stubGlobal( 'fetch', fetchMock );
	} );

	afterEach( () => {
		fetchMock.mockReset();
		vi.unstubAllGlobals();
	} );

	it( 'starts a device sign-in on GitHub', async () => {
		respond( {
			'/login/device/code': () =>
				json( 200, {
					device_code: 'device',
					user_code: 'ABCD-1234',
					verification_uri: 'https://github.com/login/device',
					interval: 5,
					expires_in: 900,
				} ),
		} );

		await expect( githubCopilotAccount.start!( 'github', { hostId: 'host' } ) ).resolves.toEqual( {
			url: 'https://github.com/login/device',
			code: 'ABCD-1234',
			handoff: { deviceCode: 'device', interval: '5', expiresAt: expect.any( String ) },
		} );
	} );

	it( 'waits for the approval, then trades the GitHub sign-in for a Copilot token', async () => {
		const polls = [ { error: 'authorization_pending' }, { access_token: 'gho_1' } ];
		respond( {
			'/login/oauth/access_token': () => json( 200, polls.shift() ),
			'/copilot_internal/v2/token': () => json( 200, { token: copilotToken, expires_at: 2000 } ),
			'/user': () => json( 200, { login: 'octocat' } ),
			'/models': () => json( 200, planModels ),
		} );

		// Only the models the plan runs are kept, and the one it leaves off is turned on first.
		await expect( githubCopilotAccount.connect( 'github', handoff ) ).resolves.toEqual( {
			method: 'github',
			githubToken: 'gho_1',
			copilotToken,
			copilotTokenExpiresAt: 2_000_000,
			login: 'octocat',
			models: [ 'claude-sonnet-5-5', 'gpt-6.1-terra' ],
		} );
		expect( fetchMock ).toHaveBeenCalledWith(
			'https://api.business.githubcopilot.com/models/gpt-6.1-terra/policy',
			expect.objectContaining( { method: 'POST' } )
		);
		expect( fetchMock ).not.toHaveBeenCalledWith(
			'https://api.business.githubcopilot.com/models/claude-sonnet-5.5/policy',
			expect.anything()
		);
	} );

	it( 'keeps every model when Copilot doesn’t say which the plan runs', async () => {
		respond( {
			'/login/oauth/access_token': () => json( 200, { access_token: 'gho_1' } ),
			'/copilot_internal/v2/token': () => json( 200, { token: copilotToken, expires_at: 2000 } ),
			'/models': () => json( 500 ),
		} );

		await expect( githubCopilotAccount.connect( 'github', handoff ) ).resolves.not.toHaveProperty(
			'models'
		);
	} );

	it( 'says when the sign-in is declined or the account has no Copilot plan', async () => {
		respond( {
			'/login/oauth/access_token': () => json( 200, { error: 'access_denied' } ),
		} );
		await expect( githubCopilotAccount.connect( 'github', handoff ) ).rejects.toMatchObject( {
			reason: 'denied',
		} );

		respond( {
			'/login/oauth/access_token': () => json( 200, { access_token: 'gho_1' } ),
			'/copilot_internal/v2/token': () => json( 404 ),
		} );
		const error = await githubCopilotAccount.connect( 'github', handoff ).catch( ( e ) => e );
		expect( error ).toBeInstanceOf( ConnectError );
		expect( error.message ).toMatch( /no Copilot plan/ );

		// A plan that runs none of Studio's models is no more usable than no plan at all.
		respond( {
			'/login/oauth/access_token': () => json( 200, { access_token: 'gho_1' } ),
			'/copilot_internal/v2/token': () => json( 200, { token: copilotToken, expires_at: 2000 } ),
			'/models': () => json( 200, { data: [ { id: 'gpt-4.1' } ] } ),
		} );
		await expect( githubCopilotAccount.connect( 'github', handoff ) ).rejects.toThrow(
			/no Copilot plan/
		);
	} );

	it( 'renews the Copilot token only when it is about to expire', async () => {
		await expect( githubCopilotAccount.refresh!( config( 30 * 60_000 ) ) ).resolves.toBeUndefined();
		expect( fetchMock ).not.toHaveBeenCalled();

		// A sign-in stored before Studio read the plan's models reads them without renewing.
		respond( { '/models': () => json( 200, planModels ) } );
		const { models } = ( await githubCopilotAccount.refresh!( {
			...config( 30 * 60_000 ),
			models: undefined,
		} ) )!;
		expect( models ).toEqual( [ 'claude-sonnet-5-5', 'gpt-6.1-terra' ] );
		fetchMock.mockReset();

		respond( {
			'/copilot_internal/v2/token': () => json( 200, { token: 'renewed', expires_at: 3000 } ),
			'/models': () => json( 200, planModels ),
		} );
		// Renewing re-reads the plan, so a model it no longer runs stops being offered.
		await expect( githubCopilotAccount.refresh!( config( 60_000 ) ) ).resolves.toMatchObject( {
			githubToken: 'gho_1',
			copilotToken: 'renewed',
			copilotTokenExpiresAt: 3_000_000,
			models: [ 'claude-sonnet-5-5', 'gpt-6.1-terra' ],
		} );
	} );

	it( 'asks to sign in again when GitHub no longer accepts the sign-in', async () => {
		respond( { '/copilot_internal/v2/token': () => json( 401 ) } );

		await expect( githubCopilotAccount.refresh!( config( 0 ) ) ).rejects.toBeInstanceOf(
			NotConnectedError
		);
	} );

	it( 'connects models on the plan’s API, under Copilot’s model names', async () => {
		const connection = await githubCopilotAi.model( config( 60_000 ), 'claude-sonnet-5-5', {} );

		expect( connection ).toMatchObject( {
			piProvider: 'github-copilot',
			apiKey: copilotToken,
			headers: { 'Copilot-Integration-Id': 'vscode-chat' },
			requestModelId: 'claude-sonnet-5.5',
			model: {
				id: 'claude-sonnet-5-5',
				api: 'anthropic-messages',
				baseUrl: 'https://api.business.githubcopilot.com',
			},
		} );
		expect( connection.rewriteError?.( '400 {"error":{"code":"model_not_supported"}}' ) ).toMatch(
			/doesn’t include this model/
		);
		expect( connection.rewriteError?.( '402 quota_exceeded' ) ).toMatch( /usage limit/ );
		expect( connection.rewriteError?.( 'socket hang up' ) ).toBeUndefined();

		await expect(
			githubCopilotAi.model( config( 60_000 ), 'gpt-6.1-terra', {} )
		).resolves.not.toHaveProperty( 'requestModelId', expect.anything() );
		await expect( githubCopilotAi.model( undefined, 'gpt-6.1-terra', {} ) ).rejects.toBeInstanceOf(
			NotConnectedError
		);
	} );
} );
