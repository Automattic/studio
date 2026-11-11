import { HOSTS, loadHosts } from '../hosts';
import wpcom from '../hosts/wpcom.json';

vi.mock( 'cli/commands/push', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/commands/pull', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/commands/pull-legacy', () => ( { runCommand: vi.fn() } ) );

describe( 'remote host manifests', () => {
	it.each( [
		{
			id: 'wpcom',
			name: 'WordPress.com',
			listKey: 'wordpressCom',
			description: '"Live" (ID: 111) at https://live.wordpress.com (WordPress.com)',
		},
	] )( 'loads the built-in $id host', ( { id, name, listKey, description } ) => {
		const host = HOSTS[ id ];
		expect( host.name ).toBe( name );
		expect( host.sites?.listKey ).toBe( listKey );
		expect(
			host.describeSite( {
				name: 'Live',
				path: '',
				running: false,
				remote: true,
				wpcomSiteId: 111,
				url: 'https://live.wordpress.com',
			} )
		).toBe( description );
	} );

	it.each( [
		[ { ...wpcom, name: undefined }, /name/ ],
		[ { ...wpcom, driver: { type: 'unknown' } }, /Unknown remote host driver: unknown/ ],
		[ { ...wpcom, driver: { type: 'wpcom-sync', unsupported: true } }, /unsupported/ ],
	] )( 'rejects an invalid manifest %j', ( manifest, message ) => {
		expect( () => loadHosts( { 'invalid.json': manifest } ) ).toThrow(
			/Invalid remote host manifest invalid.json/
		);
		expect( () => loadHosts( { 'invalid.json': manifest } ) ).toThrow( message );
	} );
} );
