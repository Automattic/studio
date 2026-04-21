import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupObsoleteServerFiles } from '../04-cleanup-obsolete-server-files';

describe( 'cleanupObsoleteServerFiles migration', () => {
	let tmpHome: string;
	let serverFiles: string;

	beforeEach( () => {
		tmpHome = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-server-files-cleanup-' ) );
		vi.spyOn( os, 'homedir' ).mockReturnValue( tmpHome );
		serverFiles = path.join( tmpHome, '.studio', 'server-files' );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		fs.rmSync( tmpHome, { recursive: true, force: true } );
	} );

	function skillsPath() {
		return path.join( serverFiles, 'skills' );
	}

	function sqlitePluginPath() {
		return path.join( serverFiles, 'sqlite-database-integration' );
	}

	function wpCliPharPath() {
		return path.join( serverFiles, 'wp-cli.phar' );
	}

	function translationsPath() {
		return path.join(
			serverFiles,
			'wordpress-versions',
			'latest',
			'available-site-translations.json'
		);
	}

	it( 'does not run when none of the obsolete entries exist', async () => {
		expect( await cleanupObsoleteServerFiles.needsToRun() ).toBe( false );
	} );

	it( 'runs when skills directory exists', async () => {
		fs.mkdirSync( skillsPath(), { recursive: true } );
		expect( await cleanupObsoleteServerFiles.needsToRun() ).toBe( true );
	} );

	it( 'runs when sqlite plugin directory exists', async () => {
		fs.mkdirSync( sqlitePluginPath(), { recursive: true } );
		expect( await cleanupObsoleteServerFiles.needsToRun() ).toBe( true );
	} );

	it( 'runs when wp-cli.phar file exists', async () => {
		fs.mkdirSync( serverFiles, { recursive: true } );
		fs.writeFileSync( wpCliPharPath(), 'phar-bytes' );
		expect( await cleanupObsoleteServerFiles.needsToRun() ).toBe( true );
	} );

	it( 'runs when translations file exists', async () => {
		fs.mkdirSync( path.dirname( translationsPath() ), { recursive: true } );
		fs.writeFileSync( translationsPath(), '{}' );
		expect( await cleanupObsoleteServerFiles.needsToRun() ).toBe( true );
	} );

	it( 'removes all obsolete entries and tolerates missing ones', async () => {
		// skills, wp-cli.phar, and translations exist; sqlite plugin is already gone.
		fs.mkdirSync( skillsPath(), { recursive: true } );
		fs.writeFileSync( path.join( skillsPath(), 'readme.md' ), 'bundled' );
		fs.mkdirSync( serverFiles, { recursive: true } );
		fs.writeFileSync( wpCliPharPath(), 'phar-bytes' );
		fs.mkdirSync( path.dirname( translationsPath() ), { recursive: true } );
		fs.writeFileSync( translationsPath(), '{}' );

		// Sibling files that should not be touched.
		const siblingFile = path.join( serverFiles, 'language-packs', 'sv_SE.l10n.php' );
		fs.mkdirSync( path.dirname( siblingFile ), { recursive: true } );
		fs.writeFileSync( siblingFile, 'keep-me' );

		await cleanupObsoleteServerFiles.run();

		expect( fs.existsSync( skillsPath() ) ).toBe( false );
		expect( fs.existsSync( translationsPath() ) ).toBe( false );
		expect( fs.existsSync( sqlitePluginPath() ) ).toBe( false );
		expect( fs.existsSync( wpCliPharPath() ) ).toBe( false );
		expect( fs.existsSync( siblingFile ) ).toBe( true );
	} );
} );
