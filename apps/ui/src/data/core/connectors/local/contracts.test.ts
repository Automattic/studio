import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalConnector } from './index';

describe( 'createLocalConnector server contracts', () => {
	const fetchMock = vi.fn();
	const connector = () => createLocalConnector( { apiBaseUrl: 'http://localhost:8081' } );

	beforeEach( () => {
		vi.clearAllMocks();
		vi.stubGlobal( 'fetch', fetchMock );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	} );

	it( 'waits for the server to delete all previews and propagates failures', async () => {
		fetchMock.mockResolvedValueOnce( new Response( null, { status: 204 } ) );
		await expect( connector().deleteAllSnapshots() ).resolves.toBeUndefined();
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/snapshots',
			expect.objectContaining( { method: 'DELETE' } )
		);
		fetchMock.mockResolvedValueOnce(
			new Response( JSON.stringify( { error: 'Preview deletion failed' } ), { status: 500 } )
		);
		await expect( connector().deleteAllSnapshots() ).rejects.toThrow( 'Preview deletion failed' );
	} );

	it( 'remembers the AI provider through the shared settings endpoint', async () => {
		fetchMock.mockResolvedValue(
			new Response( JSON.stringify( { provider: 'anthropic-api-key', hasAnthropicApiKey: true } ) )
		);
		await expect( connector().setAiProvider( 'anthropic-api-key' ) ).resolves.toMatchObject( {
			provider: 'anthropic-api-key',
		} );
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/ai-settings/provider',
			expect.objectContaining( {
				method: 'PUT',
				body: JSON.stringify( { provider: 'anthropic-api-key' } ),
			} )
		);
	} );

	it( 'saves and clears custom titles through the existing session metadata endpoint', async () => {
		fetchMock.mockResolvedValue(
			new Response( JSON.stringify( { id: 'chat-1', title: 'Homepage polish' } ) )
		);
		const local = connector();
		await expect(
			local.updateSessionMetadata( 'chat-1', { title: 'Homepage polish' } )
		).resolves.toMatchObject( { title: 'Homepage polish' } );
		expect( fetchMock ).toHaveBeenLastCalledWith(
			'http://localhost:8081/api/sessions/chat-1',
			expect.objectContaining( {
				method: 'PATCH',
				body: JSON.stringify( { title: 'Homepage polish' } ),
			} )
		);
		fetchMock.mockResolvedValue( new Response( JSON.stringify( { id: 'chat-1' } ) ) );
		await local.updateSessionMetadata( 'chat-1', { title: '' } );
		expect( fetchMock ).toHaveBeenLastCalledWith(
			'http://localhost:8081/api/sessions/chat-1',
			expect.objectContaining( { method: 'PATCH', body: JSON.stringify( { title: '' } ) } )
		);
	} );

	it( 'forwards app-wide skill reads, installs and removals to the local server', async () => {
		fetchMock.mockImplementation( async ( input ) =>
			String( input ).endsWith( '/api/skills' )
				? new Response( JSON.stringify( [ { id: 'studio-cli', installed: true } ] ) )
				: new Response( null, { status: 204 } )
		);
		const local = connector();
		await expect( local.getWordPressSkillsStatusAllSites() ).resolves.toEqual( [
			{ id: 'studio-cli', installed: true },
		] );
		await local.installWordPressSkillToAllSites( 'studio-cli' );
		await local.removeWordPressSkillFromAllSites( 'studio-cli' );
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/skills/studio-cli',
			expect.objectContaining( { method: 'POST' } )
		);
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/skills/studio-cli',
			expect.objectContaining( { method: 'DELETE' } )
		);
	} );

	it( 'uses the CLI copy-token redirect when the server has no OAuth client', async () => {
		fetchMock.mockImplementation( async ( input ) =>
			String( input ).includes( '/auth/login-url' )
				? new Response( JSON.stringify( { url: null } ) )
				: new Response( JSON.stringify( { id: 1 } ) )
		);
		const open = vi.spyOn( window, 'open' ).mockReturnValue( null );
		vi.spyOn( window, 'prompt' ).mockReturnValue( '  test-token  ' );
		await connector().authenticate();
		const url = new URL( String( open.mock.calls.at( -1 )![ 0 ] ) );
		expect( url.searchParams.get( 'redirect_uri' ) ).toBe(
			'https://developer.wordpress.com/copy-oauth-token'
		);
		expect( fetchMock ).toHaveBeenLastCalledWith(
			'http://localhost:8081/api/auth/login',
			expect.objectContaining( { method: 'POST', body: JSON.stringify( { token: 'test-token' } ) } )
		);
	} );

	it( 'does not store a token when the paste flow is cancelled', async () => {
		fetchMock.mockResolvedValue( new Response( JSON.stringify( { url: null } ) ) );
		vi.spyOn( window, 'open' ).mockReturnValue( null );
		vi.spyOn( window, 'prompt' ).mockReturnValue( null );
		await connector().authenticate();
		expect( fetchMock ).not.toHaveBeenCalledWith(
			'http://localhost:8081/api/auth/login',
			expect.anything()
		);
	} );

	it( 'reads and writes the chat startup preference through the server', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response( JSON.stringify( { autoStartSiteOnChat: true } ) )
		);
		fetchMock.mockResolvedValueOnce( new Response( null, { status: 204 } ) );
		const local = connector();
		await expect( local.getUserPreferences() ).resolves.toMatchObject( {
			autoStartSiteOnChat: true,
		} );
		await local.setUserPreferences( { autoStartSiteOnChat: false } );
		expect( fetchMock ).toHaveBeenLastCalledWith(
			'http://localhost:8081/api/user-preferences',
			expect.objectContaining( {
				method: 'PATCH',
				body: JSON.stringify( { autoStartSiteOnChat: false } ),
			} )
		);
	} );

	it( 'persists session environments through the local server', async () => {
		fetchMock.mockResolvedValue( new Response( null, { status: 204 } ) );
		await expect( connector().setSessionEnvironment( 'chat', 'live' ) ).resolves.toBeUndefined();
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/sessions/chat/environment',
			expect.objectContaining( {
				method: 'POST',
				body: JSON.stringify( { environment: 'live' } ),
			} )
		);
	} );
} );
