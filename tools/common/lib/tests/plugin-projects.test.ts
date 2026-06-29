import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	bumpPluginProjectVersion,
	bumpPluginVersion,
	calculateDevelopmentProjectVersionState,
	compareVersions,
	discoverPluginProject,
	parsePluginHeaders,
} from '@studio/common/lib/plugin-projects';

let testDir: string;

async function writeFile( relativePath: string, content: string ) {
	const filePath = path.join( testDir, relativePath );
	await fs.mkdir( path.dirname( filePath ), { recursive: true } );
	await fs.writeFile( filePath, content );
	return filePath;
}

describe( 'plugin projects', () => {
	beforeEach( async () => {
		testDir = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-plugin-project-' ) );
	} );

	afterEach( async () => {
		await fs.rm( testDir, { force: true, recursive: true } );
	} );

	it( 'parses WordPress plugin headers', () => {
		const headers = parsePluginHeaders( `<?php
/**
 * Plugin Name: Pressship Example
 * Description: Builds release ships.
 * Version: 1.2.3
 * Text Domain: pressship-example
 * Requires at least: 6.5
 * Tested up to: 6.8
 * Requires PHP: 8.1
 */` );

		expect( headers ).toEqual( {
			name: 'Pressship Example',
			description: 'Builds release ships.',
			version: '1.2.3',
			textDomain: 'pressship-example',
			requiresAtLeast: '6.5',
			testedUpTo: '6.8',
			requiresPhp: '8.1',
		} );
	} );

	it( 'discovers the root plugin file and readme metadata', async () => {
		const mainFile = await writeFile(
			'pressship-example.php',
			`<?php
/**
 * Plugin Name: Pressship Example
 * Version: 1.0.0
 * Text Domain: pressship-example
 */`
		);
		await writeFile(
			'readme.txt',
			`=== Pressship Example ===
Stable tag: 1.0.0
Requires at least: 6.4
Tested up to: 6.8
Requires PHP: 8.0`
		);
		await writeFile(
			'includes/class-helper.php',
			`<?php
/**
 * Plugin Name: Helper File
 */`
		);

		const project = await discoverPluginProject( testDir );

		expect( project.mainFile ).toBe( mainFile );
		expect( project.name ).toBe( 'Pressship Example' );
		expect( project.slug ).toBe( 'pressship-example' );
		expect( project.version ).toBe( '1.0.0' );
		expect( project.stableTag ).toBe( '1.0.0' );
		expect( project.requiresAtLeast ).toBe( '6.4' );
		expect( project.testedUpTo ).toBe( '6.8' );
		expect( project.requiresPhp ).toBe( '8.0' );
	} );

	it( 'discovers plugin metadata from WordPress.org SVN trunk checkouts', async () => {
		const mainFile = await writeFile(
			'trunk/pressship-example.php',
			`<?php
/**
 * Plugin Name: Pressship Example
 * Version: 1.0.0
 * Text Domain: pressship-example
 */`
		);
		await writeFile(
			'trunk/readme.txt',
			`=== Pressship Example ===
Stable tag: 1.0.0`
		);
		await writeFile( 'tags/0.9.0/pressship-example.php', '<?php' );

		const project = await discoverPluginProject( testDir );

		expect( project.rootDir ).toBe( path.join( testDir, 'trunk' ) );
		expect( project.mainFile ).toBe( mainFile );
		expect( project.readmePath ).toBe( path.join( testDir, 'trunk', 'readme.txt' ) );
	} );

	it( 'rejects folders without a plugin header', async () => {
		await writeFile( 'index.php', '<?php // Silence is golden.' );

		await expect( discoverPluginProject( testDir ) ).rejects.toThrow(
			'No WordPress plugin header'
		);
	} );

	it( 'bumps plugin header and readme stable tag versions', async () => {
		await writeFile(
			'pressship-example.php',
			`<?php
/**
 * Plugin Name: Pressship Example
 * Version: 1.2.3
 * Text Domain: pressship-example
 */`
		);
		await writeFile(
			'readme.txt',
			`=== Pressship Example ===
Stable tag: 1.2.3`
		);

		const project = await discoverPluginProject( testDir );
		const nextVersion = await bumpPluginProjectVersion( project, 'minor' );
		const updated = await discoverPluginProject( testDir );

		expect( nextVersion ).toBe( '1.3.0' );
		expect( updated.version ).toBe( '1.3.0' );
		expect( updated.stableTag ).toBe( '1.3.0' );
	} );

	it( 'calculates version state and next versions', () => {
		expect(
			calculateDevelopmentProjectVersionState( {
				slug: 'pressship-example',
				name: 'Pressship Example',
				path: '/tmp/pressship-example',
				localVersion: '1.2.3',
				readmeStableTag: '1.2.3',
				remoteVersion: '1.2.2',
				svnTags: [ '1.2.1', '1.2.2' ],
				svnTagsSource: 'remote',
			} )
		).toMatchObject( {
			statuses: [ 'ready' ],
			releaseBlocked: false,
			latestSvnTag: '1.2.2',
			nextVersions: {
				patch: '1.2.4',
				minor: '1.3.0',
				major: '2.0.0',
			},
		} );

		expect(
			calculateDevelopmentProjectVersionState( {
				slug: 'pressship-example',
				name: 'Pressship Example',
				path: '/tmp/pressship-example',
				localVersion: '1.2.3',
				readmeStableTag: '1.2.2',
				svnTags: [ '1.2.3' ],
				svnTagsSource: 'local',
			} ).statuses
		).toEqual( [ 'header_readme_mismatch', 'duplicate_tag_blocked' ] );
		expect( compareVersions( '1.2.4', '1.2.3' ) ).toBe( 1 );
		expect( bumpPluginVersion( '1.2.3', 'patch' ) ).toBe( '1.2.4' );
	} );
} );
