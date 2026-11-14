import wpcomFactory from '@studio/common/lib/wpcom-factory';
import { vi } from 'vitest';
import { getWpComSites } from 'cli/lib/api';

vi.mock( 'wpcom' );
vi.mock( 'wpcom-xhr-request' );
vi.mock( '@studio/common/lib/wpcom-factory', () => ( {
	__esModule: true,
	default: vi.fn(),
} ) );

type WpcomReqMethods = Pick< ReturnType< typeof wpcomFactory >[ 'req' ], 'post' | 'get' >;
type WpcomFactory = ReturnType< typeof wpcomFactory >;
const createWpcomMock = ( req: Partial< WpcomReqMethods > ): WpcomFactory =>
	( { req: req } ) as WpcomFactory;

describe( 'API Module', () => {
	const mockToken = 'mock-token-123';

	beforeEach( () => {
		vi.clearAllMocks();
		vi.stubGlobal( 'fetch', vi.fn() );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	describe( 'getWpComSites', () => {
		it( 'maps the response to { id, name, url } and excludes deleted and a8c-owned sites', async () => {
			const get = vi.fn().mockResolvedValue( {
				sites: [
					{ ID: 1, name: 'Keep', URL: 'https://keep.example.com' },
					{ ID: 2, name: 'Deleted', URL: 'https://deleted.example.com', is_deleted: true },
					{ ID: 3, name: 'A8c', URL: 'https://a8c.example.com', is_a8c: true },
				],
			} );
			vi.mocked( wpcomFactory ).mockReturnValue( createWpcomMock( { get } ) );

			const sites = await getWpComSites( mockToken );

			expect( sites ).toEqual( [ { id: 1, name: 'Keep', url: 'https://keep.example.com' } ] );
			expect( get ).toHaveBeenCalledWith(
				expect.objectContaining( { path: '/me/sites' } ),
				expect.objectContaining( { fields: 'ID,name,URL,is_deleted,is_a8c' } )
			);
		} );
	} );
} );
