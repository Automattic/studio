import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVisibility, setVisibility } from '../visibility';

function grant( id = 'grt_public', audience = 'public' ) {
	return {
		grant: {
			id,
			audience: { kind: audience },
			capabilities: [ 'page.view' ],
			target: { kind: 'live' },
			resources: { include: [ '/**' ], exclude: [] as string[] },
			constraints: {} as Record< string, unknown >,
			source: { kind: 'managed' },
		},
		status: 'active',
		sourceExplanation: { editable: true },
	};
}
function api( initial = [ grant() ], { policy = false, confirm = true, operation = false } = {} ) {
	let grants = initial;
	const writes: { method: string; path: string; body?: unknown }[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn( async ( url: URL, init: RequestInit ) => {
			const path = url.pathname;
			const method = init.method ?? 'GET';
			if ( method !== 'GET' ) {
				writes.push( {
					method,
					path,
					body: init.body ? JSON.parse( String( init.body ) ) : undefined,
				} );
				if ( confirm )
					grants =
						method === 'POST'
							? [ ...grants, grant() ]
							: grants.filter( ( item ) => ! path.endsWith( item.grant.id ) );
				return Response.json( {
					data: {},
					operation: operation ? { id: 'op_1', status: 'running' } : null,
				} );
			}
			if ( path.startsWith( '/v1/operations/' ) )
				return Response.json( { data: { id: 'op_1', status: 'succeeded' } } );
			return Response.json( {
				data: path.endsWith( '/grants' )
					? grants
					: {
							liveUrl: 'https://example.space.fast',
							teamAccessPolicy: { privateSpacesOnly: policy },
					  },
			} );
		} )
	);
	return writes;
}
afterEach( () => vi.unstubAllGlobals() );
describe( 'Spacefast visibility', () => {
	it( 'reads public and restricted access from live grants', async () => {
		api();
		expect( ( await getVisibility( 'key', 'spc_1' ) ).visibility ).toBe( 'public' );
		api( [ grant( 'team', 'team' ) ] );
		expect( ( await getVisibility( 'key', 'spc_1' ) ).visibility ).toBe( 'private' );
	} );
	it( 'grants only public viewing and confirms the result', async () => {
		const writes = api( [] );
		expect( ( await setVisibility( 'key', 'spc_1', 'public' ) ).visibility ).toBe( 'public' );
		expect( writes ).toEqual( [
			{
				method: 'POST',
				path: '/v1/spaces/spc_1/grants',
				body: {
					audience: { kind: 'public' },
					capabilities: [ 'page.view' ],
					resources: { include: [ '/**' ], exclude: [] },
					target: { kind: 'live' },
				},
			},
		] );
	} );
	it( 'revokes public grants but preserves team, person, link and password access', async () => {
		const writes = api( [
			grant(),
			grant( 'grt_2' ),
			...[ 'team', 'person', 'link', 'password' ].map( ( kind ) => grant( kind, kind ) ),
		] );
		expect( ( await setVisibility( 'key', 'spc_1', 'private' ) ).visibility ).toBe( 'private' );
		expect( writes.map( ( write ) => write.path ) ).toEqual( [
			'/v1/spaces/spc_1/grants/grt_public',
			'/v1/spaces/spc_1/grants/grt_2',
		] );
	} );
	it.each( [
		'config',
		'partial',
		'constrained',
		'scheduled',
		'all_versions',
		'version',
		'uneditable',
	] )( 'does not change %s access rules', async ( kind ) => {
		const entry = grant();
		if ( kind === 'config' ) entry.grant.source.kind = 'config';
		if ( kind === 'partial' ) entry.grant.resources.include = [ '/blog/**' ];
		if ( kind === 'constrained' ) entry.grant.constraints = { maxUses: 10 };
		if ( kind === 'scheduled' ) entry.status = 'scheduled';
		if ( kind === 'all_versions' || kind === 'version' ) entry.grant.target.kind = kind;
		if ( kind === 'uneditable' ) entry.sourceExplanation.editable = false;
		const writes = api( [ entry ] );
		expect( ( await getVisibility( 'key', 'spc_1' ) ).availableValues ).toEqual( [] );
		await expect( setVisibility( 'key', 'spc_1', 'private' ) ).rejects.toThrow(
			'Manage these access rules'
		);
		expect( writes ).toEqual( [] );
	} );
	it( 'respects team restrictions without writing', async () => {
		const writes = api( [], { policy: true } );
		expect( ( await getVisibility( 'key', 'spc_1' ) ).availableValues ).toEqual( [ 'private' ] );
		await expect( setVisibility( 'key', 'spc_1', 'public' ) ).rejects.toThrow( 'team only allows' );
		expect( writes ).toEqual( [] );
	} );
	it( 'does not claim success when public access remains', async () => {
		api( [ grant() ], { confirm: false } );
		await expect( setVisibility( 'key', 'spc_1', 'private' ) ).rejects.toThrow(
			'could not be confirmed'
		);
	} );
	it( 'waits for the access operation before confirming', async () => {
		api( [], { operation: true } );
		expect( ( await setVisibility( 'key', 'spc_1', 'public' ) ).visibility ).toBe( 'public' );
		expect( fetch ).toHaveBeenCalledWith(
			new URL( 'https://api.spacefast.com/v1/operations/op_1' ),
			expect.anything()
		);
	} );
	it( 'fails closed on malformed or denied API responses', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn( async () => Response.json( { data: {} } ) )
		);
		await expect( getVisibility( 'key', 'spc_1' ) ).rejects.toThrow();
		vi.stubGlobal(
			'fetch',
			vi.fn( async () => Response.json( { detail: 'Access denied' }, { status: 403 } ) )
		);
		await expect( setVisibility( 'key', 'spc_1', 'public' ) ).rejects.toThrow( 'Access denied' );
	} );
} );
