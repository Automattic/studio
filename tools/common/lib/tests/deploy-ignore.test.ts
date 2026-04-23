import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDeployIgnoreFilter } from '@studio/common/lib/deploy-ignore';

function createTempDir(): string {
	return fs.mkdtempSync( path.join( os.tmpdir(), 'deploy-ignore-test-' ) );
}

describe( 'createDeployIgnoreFilter', () => {
	let tempDir: string;

	beforeEach( () => {
		tempDir = createTempDir();
	} );

	afterEach( () => {
		fs.rmSync( tempDir, { recursive: true, force: true } );
	} );

	it( 'should exclude default patterns when no .deployignore exists', async () => {
		const ig = await createDeployIgnoreFilter( tempDir );
		expect( ig.ignores( '.git' ) ).toBe( true );
		expect( ig.ignores( 'node_modules' ) ).toBe( true );
		expect( ig.ignores( '.DS_Store' ) ).toBe( true );
		expect( ig.ignores( 'Thumbs.db' ) ).toBe( true );
	} );

	it( 'should not exclude regular files when no .deployignore exists', async () => {
		const ig = await createDeployIgnoreFilter( tempDir );
		expect( ig.ignores( 'wp-content/plugins/my-plugin/index.php' ) ).toBe( false );
		expect( ig.ignores( 'wp-config.php' ) ).toBe( false );
	} );

	it( 'should apply patterns from .deployignore file', async () => {
		fs.writeFileSync( path.join( tempDir, '.deployignore' ), 'vendor\n*.log\n' );
		const ig = await createDeployIgnoreFilter( tempDir );
		expect( ig.ignores( 'vendor' ) ).toBe( true );
		expect( ig.ignores( 'wp-content/plugins/my-plugin/vendor' ) ).toBe( true );
		expect( ig.ignores( 'error.log' ) ).toBe( true );
		expect( ig.ignores( 'wp-content/debug.log' ) ).toBe( true );
	} );

	it( 'should still apply defaults when .deployignore exists', async () => {
		fs.writeFileSync( path.join( tempDir, '.deployignore' ), 'vendor\n' );
		const ig = await createDeployIgnoreFilter( tempDir );
		expect( ig.ignores( '.git' ) ).toBe( true );
		expect( ig.ignores( 'node_modules' ) ).toBe( true );
	} );

	it( 'should support negation patterns', async () => {
		fs.writeFileSync( path.join( tempDir, '.deployignore' ), '*.log\n!important.log\n' );
		const ig = await createDeployIgnoreFilter( tempDir );
		expect( ig.ignores( 'error.log' ) ).toBe( true );
		expect( ig.ignores( 'important.log' ) ).toBe( false );
	} );

	it( 'should ignore comments and blank lines', async () => {
		fs.writeFileSync(
			path.join( tempDir, '.deployignore' ),
			'# This is a comment\n\nvendor\n\n# Another comment\n'
		);
		const ig = await createDeployIgnoreFilter( tempDir );
		expect( ig.ignores( 'vendor' ) ).toBe( true );
		expect( ig.ignores( '# This is a comment' ) ).toBe( false );
	} );

	it( 'should support glob patterns', async () => {
		fs.writeFileSync( path.join( tempDir, '.deployignore' ), 'uploads/2024/**\n' );
		const ig = await createDeployIgnoreFilter( tempDir );
		expect( ig.ignores( 'uploads/2024/photo.jpg' ) ).toBe( true );
		expect( ig.ignores( 'uploads/2025/photo.jpg' ) ).toBe( false );
	} );

	it( 'should apply provided base patterns instead of built-in defaults', async () => {
		const ig = await createDeployIgnoreFilter( tempDir, [ 'cache', 'database' ] );
		expect( ig.ignores( 'cache' ) ).toBe( true );
		expect( ig.ignores( 'database' ) ).toBe( true );
		expect( ig.ignores( '.git' ) ).toBe( false );
	} );

	it( 'should allow .deployignore to override provided base patterns via negation', async () => {
		fs.writeFileSync( path.join( tempDir, '.deployignore' ), '!cache\n' );
		const ig = await createDeployIgnoreFilter( tempDir, [ 'cache', 'database' ] );
		expect( ig.ignores( 'cache' ) ).toBe( false );
		expect( ig.ignores( 'database' ) ).toBe( true );
	} );

	it( 'should handle empty .deployignore file', async () => {
		fs.writeFileSync( path.join( tempDir, '.deployignore' ), '' );
		const ig = await createDeployIgnoreFilter( tempDir );
		expect( ig.ignores( '.git' ) ).toBe( true );
		expect( ig.ignores( 'wp-content/index.php' ) ).toBe( false );
	} );
} );
