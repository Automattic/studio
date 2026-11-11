import { readAuthToken } from '@studio/common/lib/shared-config';
import { getWpComSites } from 'cli/lib/api';
import { HOSTS } from '../hosts';

vi.mock( '@studio/common/lib/shared-config', () => ( { readAuthToken: vi.fn() } ) );
vi.mock( 'cli/lib/api', () => ( { getWpComSites: vi.fn() } ) );
vi.mock( 'cli/commands/push', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/commands/pull', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/commands/pull-legacy', () => ( { runCommand: vi.fn() } ) );

const sites = [ { id: 111, name: 'Live', url: 'https://live.wordpress.com' } ];

describe( 'WordPress.com remote host', () => {
	it.each( [
		[ 'signed in', 'token', undefined, { signedIn: true, sites } ],
		[ 'signed out', undefined, undefined, { signedIn: false, sites: [] } ],
		[
			'request failure',
			'token',
			new Error( 'Failed to fetch' ),
			{ signedIn: true, sites: [], error: 'Failed to fetch' },
		],
		[
			'non-Error failure',
			'token',
			'Unavailable',
			{ signedIn: true, sites: [], error: 'Unavailable' },
		],
	] )( 'lists sites when %s', async ( _label, token, error, expected ) => {
		vi.mocked( readAuthToken ).mockResolvedValue(
			token ? ( { accessToken: token } as never ) : null
		);
		if ( error ) {
			vi.mocked( getWpComSites ).mockRejectedValue( error );
		} else {
			vi.mocked( getWpComSites ).mockResolvedValue( sites as never );
		}
		expect( Object.keys( HOSTS ) ).toEqual( [ 'wpcom' ] );
		expect( HOSTS.wpcom.sites!.listKey ).toBe( 'wordpressCom' );
		expect( await HOSTS.wpcom.sites!.list() ).toEqual( expected );
		if ( token ) {
			expect( getWpComSites ).toHaveBeenCalledWith( token );
		} else {
			expect( getWpComSites ).not.toHaveBeenCalled();
		}
	} );
} );
