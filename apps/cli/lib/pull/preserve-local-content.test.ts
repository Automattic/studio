import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { preserveUnselectedLocalContent } from './preserve-local-content';

const CONTENT_DIR = '/srv/htdocs/wp-content';

describe( 'preserveUnselectedLocalContent', () => {
	let root: string;
	let sitePath: string;
	let rawDirectory: string;
	let localContent: string;
	let rawContent: string;

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-preserve-' ) );
		sitePath = path.join( root, 'site' );
		rawDirectory = path.join( root, 'raw' );
		localContent = path.join( sitePath, 'wp-content' );
		rawContent = path.join( rawDirectory, 'srv', 'htdocs', 'wp-content' );
		fs.mkdirSync( localContent, { recursive: true } );
		fs.mkdirSync( rawContent, { recursive: true } );
	} );

	afterEach( () => {
		fs.rmSync( root, { recursive: true, force: true } );
	} );

	function writeLocal( relativePath: string, contents = 'local' ): void {
		const filePath = path.join( localContent, relativePath );
		fs.mkdirSync( path.dirname( filePath ), { recursive: true } );
		fs.writeFileSync( filePath, contents );
	}

	function writeRaw( relativePath: string, contents = 'remote' ): void {
		const filePath = path.join( rawContent, relativePath );
		fs.mkdirSync( path.dirname( filePath ), { recursive: true } );
		fs.writeFileSync( filePath, contents );
	}

	function rawFile( relativePath: string ): string | null {
		try {
			return fs.readFileSync( path.join( rawContent, relativePath ), 'utf-8' );
		} catch {
			return null;
		}
	}

	it( 'moves unselected folders into the scratch and leaves selected ones to the remote', () => {
		writeLocal( 'plugins/local-plugin/plugin.php' );
		writeLocal( 'themes/local-theme/style.css' );
		writeRaw( 'themes/remote-theme/style.css' );

		const moved = preserveUnselectedLocalContent( {
			sitePath,
			rawDirectory,
			contentDir: CONTENT_DIR,
			selectedPrefixes: [ `${ CONTENT_DIR }/themes` ],
		} );

		// plugins (unselected, absent from raw) moved wholesale…
		expect( moved ).toBe( 1 );
		expect( rawFile( 'plugins/local-plugin/plugin.php' ) ).toBe( 'local' );
		expect( fs.existsSync( path.join( localContent, 'plugins' ) ) ).toBe( false );
		// …while the selected themes folder belongs to the remote.
		expect( rawFile( 'themes/local-theme/style.css' ) ).toBeNull();
		expect( rawFile( 'themes/remote-theme/style.css' ) ).toBe( 'remote' );
	} );

	it( 'preserves siblings of a selected subfolder by merging one level down', () => {
		writeLocal( 'plugins/local-plugin/plugin.php' );
		writeRaw( 'plugins/akismet/akismet.php' );

		preserveUnselectedLocalContent( {
			sitePath,
			rawDirectory,
			contentDir: CONTENT_DIR,
			selectedPrefixes: [ `${ CONTENT_DIR }/plugins/akismet` ],
		} );

		expect( rawFile( 'plugins/local-plugin/plugin.php' ) ).toBe( 'local' );
		expect( rawFile( 'plugins/akismet/akismet.php' ) ).toBe( 'remote' );
	} );

	it( 'preserves siblings of a selected single-file plugin', () => {
		writeLocal( 'plugins/local-plugin/plugin.php' );
		writeLocal( 'plugins/hello.php', 'local' );
		writeRaw( 'plugins/hello.php', 'remote' );

		preserveUnselectedLocalContent( {
			sitePath,
			rawDirectory,
			contentDir: CONTENT_DIR,
			selectedPrefixes: [ `${ CONTENT_DIR }/plugins/hello.php` ],
		} );

		expect( rawFile( 'plugins/local-plugin/plugin.php' ) ).toBe( 'local' );
		expect( rawFile( 'plugins/hello.php' ) ).toBe( 'remote' );
	} );

	it( 'lets a remote file win when both sides have it', () => {
		writeLocal( 'index.php', 'local' );
		writeRaw( 'index.php', 'remote' );

		preserveUnselectedLocalContent( {
			sitePath,
			rawDirectory,
			contentDir: CONTENT_DIR,
			selectedPrefixes: [ `${ CONTENT_DIR }/themes` ],
		} );

		expect( rawFile( 'index.php' ) ).toBe( 'remote' );
	} );

	it( 'treats an empty selection as everything-selected but still honors the database toggle', () => {
		writeLocal( 'plugins/local-plugin/plugin.php' );
		writeLocal( 'database/.ht.sqlite', 'local-db' );

		const moved = preserveUnselectedLocalContent( {
			sitePath,
			rawDirectory,
			contentDir: CONTENT_DIR,
			selectedPrefixes: [],
			skipDatabase: true,
		} );

		// Full file selection → plugins belong to the remote…
		expect( rawFile( 'plugins/local-plugin/plugin.php' ) ).toBeNull();
		// …but the kept database moves across.
		expect( moved ).toBe( 1 );
		expect( rawFile( 'database/.ht.sqlite' ) ).toBe( 'local-db' );
	} );

	it( 'keeps the pulled database when the database was selected', () => {
		writeLocal( 'database/.ht.sqlite', 'local-db' );
		writeRaw( 'database/.ht.sqlite', 'remote-db' );

		preserveUnselectedLocalContent( {
			sitePath,
			rawDirectory,
			contentDir: CONTENT_DIR,
			selectedPrefixes: [],
			skipDatabase: false,
		} );

		expect( rawFile( 'database/.ht.sqlite' ) ).toBe( 'remote-db' );
	} );

	it( 'no-ops once the site is flattened (wp-content is a symlink)', () => {
		fs.rmSync( localContent, { recursive: true, force: true } );
		fs.symlinkSync( rawContent, localContent );
		writeRaw( 'themes/remote-theme/style.css' );

		const moved = preserveUnselectedLocalContent( {
			sitePath,
			rawDirectory,
			contentDir: CONTENT_DIR,
			selectedPrefixes: [ `${ CONTENT_DIR }/themes` ],
		} );

		expect( moved ).toBe( 0 );
	} );

	it( 'no-ops when the site has no wp-content directory', () => {
		fs.rmSync( localContent, { recursive: true, force: true } );

		expect(
			preserveUnselectedLocalContent( {
				sitePath,
				rawDirectory,
				contentDir: CONTENT_DIR,
				selectedPrefixes: [],
			} )
		).toBe( 0 );
	} );
} );
