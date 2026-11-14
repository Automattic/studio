import { afterEach, expect, it, vi } from 'vitest';
import { ConnectError, NotConnectedError } from '../../errors';
import { spacefastServices } from '../services';

afterEach( () => {
	vi.unstubAllGlobals();
} );

it( 'says when the user declined the sign-in', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn( async () => new Response( JSON.stringify( { data: { status: 'denied' } } ) ) )
	);

	await expect(
		spacefastServices.account.connect( 'sign-in', {
			deviceCode: 'dev_1',
			interval: '1',
			expiresAt: new Date( Date.now() + 60_000 ).toISOString(),
		} )
	).rejects.toEqual( new ConnectError( 'Spacefast sign-in was declined.', 'denied' ) );
} );

it( 'asks to connect again when the key no longer works', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () => new Response( JSON.stringify( { title: 'Unauthorized' } ), { status: 401 } )
		)
	);

	await expect( spacefastServices.sites!.list( { apiKey: 'sfa_old' } ) ).rejects.toBeInstanceOf(
		NotConnectedError
	);
} );

it( 'keeps the team slug for site-specific dashboard links', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async ( url: URL ) =>
				new Response(
					JSON.stringify( {
						data:
							url.pathname === '/v1/teams'
								? [ { id: 'team', name: 'Studio', slug: 'studio' } ]
								: [
										{
											id: 'space',
											title: 'Example',
											slug: 'example',
											liveUrl: 'https://example.space.fast',
											teamId: 'team',
										},
								  ],
					} )
				)
		)
	);
	const [ site ] = await spacefastServices.sites!.list( { apiKey: 'test' } );
	expect( site ).toMatchObject( { teamSlug: 'studio', slug: 'example' } );
} );

it.each( [
	{ privateOnly: false, requested: 'public', access: 'public' },
	{ privateOnly: false, requested: 'private', access: 'private' },
	{ privateOnly: true, requested: undefined, access: 'private' },
	{ privateOnly: true, requested: 'public', access: undefined },
] as const )(
	'enforces team access when creating a Space ($privateOnly, $requested)',
	async ( { privateOnly, requested, access } ) => {
		const fetch = vi.fn( async ( url: URL, _options: RequestInit ) => {
			if ( url.pathname === '/v1/teams' ) {
				return Response.json( { data: [ { id: 'team', name: 'Studio', slug: 'studio' } ] } );
			}
			if ( url.pathname === '/v1/teams/team/access/defaults' ) {
				return Response.json( { data: { privateSpacesOnly: privateOnly } } );
			}
			return Response.json( {
				data: {
					space: {
						id: 'spc_1',
						title: 'Example',
						slug: 'example',
						liveUrl: 'https://example.space.fast',
						teamId: 'team',
					},
				},
			} );
		} );
		vi.stubGlobal( 'fetch', fetch );
		const config = { apiKey: 'test' };
		await expect( spacefastServices.sites!.creationVisibility!( config ) ).resolves.toBe(
			privateOnly ? 'private' : 'public'
		);
		const creation = spacefastServices.sites!.create!( config, {
			name: 'Example',
			visibility: requested,
		} );
		if ( ! access ) {
			await expect( creation ).rejects.toThrow( 'Your team only allows restricted sites.' );
			expect( fetch.mock.calls.some( ( [ , options ] ) => options.method === 'POST' ) ).toBe(
				false
			);
			return;
		}
		await expect( creation ).resolves.toMatchObject( { id: 'spc_1' } );
		const post = fetch.mock.calls.find( ( [ , options ] ) => options.method === 'POST' );
		expect( post?.[ 0 ].pathname ).toBe( '/v1/spaces' );
		expect( JSON.parse( post?.[ 1 ].body as string ) ).toEqual( {
			teamId: 'team',
			title: 'Example',
			access,
			capabilities: [ 'optional_access' ],
		} );
	}
);
