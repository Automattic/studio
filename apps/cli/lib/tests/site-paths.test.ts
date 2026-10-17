import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadSitePaths( env: Record< string, string | undefined > ) {
	vi.resetModules();
	for ( const [ key, value ] of Object.entries( env ) ) {
		vi.stubEnv( key, value as string );
	}
	return import( 'cli/lib/site-paths' );
}

afterEach( () => {
	vi.unstubAllEnvs();
} );

describe( 'STUDIO_SITES_ROOT', () => {
	it( 'is ~/Studio', async () => {
		const { STUDIO_SITES_ROOT, getDefaultSitePath } = await loadSitePaths( {
			E2E: '',
			E2E_SITES_ROOT: '/tmp/eval-a',
		} );
		expect( STUDIO_SITES_ROOT ).toBe( path.join( os.homedir(), 'Studio' ) );
		expect( getDefaultSitePath( 'Eval Test Site' ) ).toBe(
			path.join( os.homedir(), 'Studio', 'eval-test-site' )
		);
	} );

	it( "gives each eval case's sites the folder the case was given", async () => {
		const a = await loadSitePaths( { E2E: '1', E2E_SITES_ROOT: '/tmp/eval-a' } );
		const b = await loadSitePaths( { E2E: '1', E2E_SITES_ROOT: '/tmp/eval-b' } );
		expect( a.getDefaultSitePath( 'Eval Test Site' ) ).toBe( '/tmp/eval-a/eval-test-site' );
		expect( b.getDefaultSitePath( 'Eval Test Site' ) ).toBe( '/tmp/eval-b/eval-test-site' );
	} );
} );
