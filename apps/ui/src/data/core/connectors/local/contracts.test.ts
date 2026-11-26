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
			new Response( JSON.stringify( { provider: 'anthropic', hasAnthropicApiKey: true } ) )
		);
		await expect( connector().setAiProvider( 'anthropic' ) ).resolves.toMatchObject( {
			provider: 'anthropic',
		} );
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/ai-settings/provider',
			expect.objectContaining( {
				method: 'PUT',
				body: JSON.stringify( { provider: 'anthropic' } ),
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

	it( 'forwards reads, switches, opens and deletes of the skills for all sites to the local server', async () => {
		fetchMock.mockImplementation( async ( input ) =>
			String( input ).endsWith( '/api/global-skills' )
				? new Response( JSON.stringify( [ { id: 'brand-voice', source: 'studio' } ] ) )
				: new Response( null, { status: 204 } )
		);
		const local = connector();
		expect( local.capabilities.globalSkills ).toBe( true );
		await expect( local.getGlobalSkills() ).resolves.toEqual( [
			{ id: 'brand-voice', source: 'studio' },
		] );
		await local.setGlobalSkillEnabled( 'agents', 'changelog', true );
		await local.openGlobalSkill( 'agents', 'changelog' );
		await local.removeGlobalSkill( 'brand-voice' );
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/global-skills/agents/changelog',
			expect.objectContaining( { method: 'PUT', body: JSON.stringify( { enabled: true } ) } )
		);
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/global-skills/agents/changelog/open',
			expect.objectContaining( { method: 'POST' } )
		);
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/global-skills/studio/brand-voice',
			expect.objectContaining( { method: 'DELETE' } )
		);
	} );

	it( 'makes, reads and changes a skill of a site, or of Studio for all sites', async () => {
		fetchMock.mockImplementation(
			async () => new Response( JSON.stringify( { id: 'lookbook-post', files: [ 'SKILL.md' ] } ) )
		);
		const local = connector();
		const draft = { name: 'Lookbook post', description: 'Lay out a post.', instructions: 'Steps.' };
		expect( local.capabilities.skillEditing ).toBe( true );
		await expect( local.createSkill( 'site one', draft ) ).resolves.toBe( 'lookbook-post' );
		await expect( local.getSkill( 'site one', 'lookbook-post' ) ).resolves.toMatchObject( {
			files: [ 'SKILL.md' ],
		} );
		await expect( local.updateSkill( 'site one', 'lookbook-post', draft ) ).resolves.toBe(
			'lookbook-post'
		);
		await local.createSkill( null, draft );
		await local.getSkill( null, 'lookbook-post' );
		await local.updateSkill( null, 'lookbook-post', draft );
		const body = JSON.stringify( draft );
		expect(
			fetchMock.mock.calls.map( ( [ url, init ] ) => [ ( init?.method ?? 'GET' ) as string, url ] )
		).toEqual( [
			[ 'POST', 'http://localhost:8081/api/sites/site%20one/skills' ],
			[ 'GET', 'http://localhost:8081/api/sites/site%20one/skills/lookbook-post' ],
			[ 'PUT', 'http://localhost:8081/api/sites/site%20one/skills/lookbook-post' ],
			[ 'POST', 'http://localhost:8081/api/global-skills/studio' ],
			[ 'GET', 'http://localhost:8081/api/global-skills/studio/lookbook-post' ],
			[ 'PUT', 'http://localhost:8081/api/global-skills/studio/lookbook-post/content' ],
		] );
		expect( fetchMock ).toHaveBeenCalledWith(
			'http://localhost:8081/api/global-skills/studio',
			expect.objectContaining( { method: 'POST', body } )
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
