/**
 * @vitest-environment node
 */
import fs from 'node:fs';
import { vi } from 'vitest';
import { isFirefoxInstalledOnLinux } from '../detect-linux-browsers';
import { findOnPath } from '../find-on-path';

vi.mock( 'node:fs', () => ( {
	default: { existsSync: vi.fn() },
	existsSync: vi.fn(),
} ) );

vi.mock( '../find-on-path', () => ( {
	findOnPath: vi.fn(),
} ) );

const HOME = '/home/tester';

function mockExistingPaths( paths: string[] ) {
	vi.mocked( fs.existsSync ).mockImplementation( ( candidate: fs.PathLike ) =>
		paths.includes( String( candidate ) )
	);
}

describe( 'isFirefoxInstalledOnLinux', () => {
	beforeEach( () => {
		vi.resetAllMocks();
		mockExistingPaths( [] );
		vi.mocked( findOnPath ).mockReturnValue( null );
	} );

	it( 'returns true when firefox is on PATH', () => {
		vi.mocked( findOnPath ).mockImplementation( ( cmd ) =>
			cmd === 'firefox' ? '/usr/bin/firefox' : null
		);
		expect( isFirefoxInstalledOnLinux( HOME ) ).toBe( true );
	} );

	it( 'returns true when ~/.mozilla/firefox exists', () => {
		mockExistingPaths( [ `${ HOME }/.mozilla/firefox` ] );
		expect( isFirefoxInstalledOnLinux( HOME ) ).toBe( true );
	} );

	it( 'returns true when Snap Firefox data dir exists', () => {
		mockExistingPaths( [ `${ HOME }/snap/firefox` ] );
		expect( isFirefoxInstalledOnLinux( HOME ) ).toBe( true );
	} );

	it( 'returns true when Flatpak Firefox dir exists', () => {
		mockExistingPaths( [ `${ HOME }/.var/app/org.mozilla.firefox` ] );
		expect( isFirefoxInstalledOnLinux( HOME ) ).toBe( true );
	} );

	it( 'returns false when neither PATH nor profile/data dirs exist', () => {
		expect( isFirefoxInstalledOnLinux( HOME ) ).toBe( false );
	} );
} );
