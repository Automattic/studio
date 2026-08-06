import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collectSymlinkAllowlistEntries, isIgnoredScanPath } from '../symlinks';

let root: string;
let sitePath: string;
let outside: string;

const makeDir = ( ...segments: string[] ) => {
	const dir = path.join( sitePath, ...segments );
	fs.mkdirSync( dir, { recursive: true } );
	return dir;
};

beforeEach( () => {
	root = fs.realpathSync.native( fs.mkdtempSync( path.join( os.tmpdir(), 'studio-symlinks-' ) ) );
	sitePath = path.join( root, 'site' );
	outside = path.join( root, 'outside' );
	fs.mkdirSync( sitePath, { recursive: true } );
	fs.mkdirSync( path.join( outside, 'shared-plugin' ), { recursive: true } );
} );

afterEach( () => {
	fs.rmSync( root, { recursive: true, force: true } );
} );

// Guards the rule the watcher and the scan share. Paths are built with
// path.posix.join to match the paths produced by chokidar.
describe( 'isIgnoredScanPath', () => {
	it( 'ignores a path ending in an ignored directory', () => {
		expect( isIgnoredScanPath( path.posix.join( 'site', 'wp-content', 'node_modules' ) ) ).toBe(
			true
		);
	} );

	it( 'ignores anything nested inside an ignored directory', () => {
		expect(
			isIgnoredScanPath(
				path.posix.join( 'site', 'wp-content', 'node_modules', 'pkg', 'index.js' )
			)
		).toBe( true );
	} );

	it( 'ignores dot-prefixed names', () => {
		expect( isIgnoredScanPath( path.posix.join( 'site', '.git', 'HEAD' ) ) ).toBe( true );
		expect( isIgnoredScanPath( path.posix.join( 'site', '.DS_Store' ) ) ).toBe( true );
	} );

	it( 'keeps ordinary paths', () => {
		expect(
			isIgnoredScanPath( path.posix.join( 'site', 'wp-content', 'plugins', 'my-plugin' ) )
		).toBe( false );
	} );

	it( 'matches whole segments only', () => {
		expect( isIgnoredScanPath( path.posix.join( 'site', 'my-node_modules-backup' ) ) ).toBe(
			false
		);
		expect( isIgnoredScanPath( path.posix.join( 'site', 'node_modules-old' ) ) ).toBe( false );
	} );

	it( 'handles an absolute path', () => {
		expect( isIgnoredScanPath( path.posix.join( root, 'site', 'node_modules' ) ) ).toBe( true );
	} );
} );

describe( 'collectSymlinkAllowlistEntries', () => {
	it( 'resolves a symlinked directory to its target', () => {
		const plugins = makeDir( 'wp-content', 'plugins' );
		fs.symlinkSync( path.join( outside, 'shared-plugin' ), path.join( plugins, 'shared-plugin' ) );

		return expect( collectSymlinkAllowlistEntries( sitePath ) ).resolves.toEqual( [
			path.join( outside, 'shared-plugin' ),
		] );
	} );

	it( 'resolves a symlinked file to its containing directory', () => {
		const plugins = makeDir( 'wp-content', 'plugins' );
		fs.writeFileSync( path.join( outside, 'shared-plugin', 'plugin.php' ), '<?php' );
		fs.symlinkSync(
			path.join( outside, 'shared-plugin', 'plugin.php' ),
			path.join( plugins, 'plugin.php' )
		);

		return expect( collectSymlinkAllowlistEntries( sitePath ) ).resolves.toEqual( [
			path.join( outside, 'shared-plugin' ),
		] );
	} );

	it( 'skips symlinks inside node_modules', () => {
		const linkFarm = makeDir( 'wp-content', 'themes', 'node_modules' );
		fs.symlinkSync( path.join( outside, 'shared-plugin' ), path.join( linkFarm, 'dep' ) );

		return expect( collectSymlinkAllowlistEntries( sitePath ) ).resolves.toEqual( [] );
	} );

	it( 'skips symlinks inside .git', () => {
		const gitDir = makeDir( '.git' );
		fs.symlinkSync( path.join( outside, 'shared-plugin' ), path.join( gitDir, 'link' ) );

		return expect( collectSymlinkAllowlistEntries( sitePath ) ).resolves.toEqual( [] );
	} );

	it( 'descends far enough to cover wp-content/<type>/<extension>', () => {
		const theme = makeDir( 'wp-content', 'themes', 'my-theme' );
		fs.symlinkSync( path.join( outside, 'shared-plugin' ), path.join( theme, 'src' ) );

		return expect( collectSymlinkAllowlistEntries( sitePath ) ).resolves.toEqual( [
			path.join( outside, 'shared-plugin' ),
		] );
	} );

	it( 'descends to any depth', () => {
		const deep = makeDir( 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h' );
		fs.symlinkSync( path.join( outside, 'shared-plugin' ), path.join( deep, 'link' ) );

		return expect( collectSymlinkAllowlistEntries( sitePath ) ).resolves.toEqual( [
			path.join( outside, 'shared-plugin' ),
		] );
	} );

	it( 'finds symlinked Composer dependencies within a plugin', () => {
		const composerVendor = makeDir( 'wp-content', 'plugins', 'my-plugin', 'vendor', 'acme' );
		fs.symlinkSync(
			path.join( outside, 'shared-plugin' ),
			path.join( composerVendor, 'dependency' )
		);

		return expect( collectSymlinkAllowlistEntries( sitePath ) ).resolves.toEqual( [
			path.join( outside, 'shared-plugin' ),
		] );
	} );

	it( 'ignores dangling symlinks', () => {
		const plugins = makeDir( 'wp-content', 'plugins' );
		fs.symlinkSync( path.join( outside, 'missing' ), path.join( plugins, 'gone' ) );

		return expect( collectSymlinkAllowlistEntries( sitePath ) ).resolves.toEqual( [] );
	} );

	it( 'deduplicates symlinks that resolve to the same target', () => {
		const plugins = makeDir( 'wp-content', 'plugins' );
		fs.symlinkSync( path.join( outside, 'shared-plugin' ), path.join( plugins, 'one' ) );
		fs.symlinkSync( path.join( outside, 'shared-plugin' ), path.join( plugins, 'two' ) );

		return expect( collectSymlinkAllowlistEntries( sitePath ) ).resolves.toEqual( [
			path.join( outside, 'shared-plugin' ),
		] );
	} );

	it( 'returns an empty list for a missing directory', () => {
		return expect(
			collectSymlinkAllowlistEntries( path.join( root, 'does-not-exist' ) )
		).resolves.toEqual( [] );
	} );
} );

// The cases above run through `find` on macOS and Linux, so the Node walker would
// otherwise only ever be exercised on Windows. Force that branch to keep the two
// implementations in agreement.
describe( 'collectSymlinkAllowlistEntries via the Node walker', () => {
	const originalPlatform = process.platform;

	beforeAll( () => {
		Object.defineProperty( process, 'platform', { value: 'win32', configurable: true } );
	} );

	afterAll( () => {
		Object.defineProperty( process, 'platform', {
			value: originalPlatform,
			configurable: true,
		} );
	} );

	it( 'resolves a symlinked directory to its target', () => {
		const plugins = makeDir( 'wp-content', 'plugins' );
		fs.symlinkSync( path.join( outside, 'shared-plugin' ), path.join( plugins, 'shared-plugin' ) );

		return expect( collectSymlinkAllowlistEntries( sitePath ) ).resolves.toEqual( [
			path.join( outside, 'shared-plugin' ),
		] );
	} );

	it( 'skips symlinks inside node_modules', () => {
		const linkFarm = makeDir( 'wp-content', 'themes', 'node_modules' );
		fs.symlinkSync( path.join( outside, 'shared-plugin' ), path.join( linkFarm, 'dep' ) );

		return expect( collectSymlinkAllowlistEntries( sitePath ) ).resolves.toEqual( [] );
	} );

	it( 'descends to any depth', () => {
		const deep = makeDir( 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h' );
		fs.symlinkSync( path.join( outside, 'shared-plugin' ), path.join( deep, 'link' ) );

		return expect( collectSymlinkAllowlistEntries( sitePath ) ).resolves.toEqual( [
			path.join( outside, 'shared-plugin' ),
		] );
	} );

	it( 'returns an empty list for a missing directory', () => {
		return expect(
			collectSymlinkAllowlistEntries( path.join( root, 'does-not-exist' ) )
		).resolves.toEqual( [] );
	} );
} );
