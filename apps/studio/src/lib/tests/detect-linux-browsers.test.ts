/**
 * @vitest-environment node
 */
import fs from 'node:fs';
import { vi } from 'vitest';
import { findOnPath } from 'src/lib/find-on-path';
import { isFirefoxInstalledOnLinux } from '../detect-linux-browsers';

vi.mock( 'node:fs', () => ( {
	default: { existsSync: vi.fn() },
	existsSync: vi.fn(),
} ) );

// Match the specifier used by the implementation so vi.mock targets the
// same module identity regardless of how the resolver normalises paths.
vi.mock( 'src/lib/find-on-path', () => ( {
	findOnPath: vi.fn(),
} ) );

const HOME = '/home/tester';

function mockExistingPaths( paths: string[] ) {
	// Normalise separators so the test passes on Windows CI, where
	// path.join in the implementation produces backslashes.
	const normalize = ( p: string ) => p.replace( /\\/g, '/' );
	const expected = paths.map( normalize );
	vi.mocked( fs.existsSync ).mockImplementation( ( candidate: fs.PathLike ) =>
		expected.includes( normalize( String( candidate ) ) )
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
