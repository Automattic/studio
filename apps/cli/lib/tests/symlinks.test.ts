import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectSymlinkAllowlistEntries } from '../symlinks';

let root: string;
let sitePath: string;
let outside: string;

const makeDir = ( ...segments: string[] ) => {
	const dir = path.join( sitePath, ...segments );
	fs.mkdirSync( dir, { recursive: true } );
	return dir;
};

beforeEach( () => {
	root = fs.realpathSync( fs.mkdtempSync( path.join( os.tmpdir(), 'studio-symlinks-' ) ) );
	sitePath = path.join( root, 'site' );
	outside = path.join( root, 'outside' );
	fs.mkdirSync( sitePath, { recursive: true } );
	fs.mkdirSync( path.join( outside, 'shared-plugin' ), { recursive: true } );
} );

afterEach( () => {
	fs.rmSync( root, { recursive: true, force: true } );
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

	it( 'finds symlinks nested deeper than four directory levels', () => {
		const deep = makeDir( 'a', 'b', 'c', 'd' );
		fs.symlinkSync( path.join( outside, 'shared-plugin' ), path.join( deep, 'link' ) );

		return expect( collectSymlinkAllowlistEntries( sitePath ) ).resolves.toEqual( [
			path.join( outside, 'shared-plugin' ),
		] );
	} );

	it( 'stops descending past the default depth limit', () => {
		const deep = makeDir( 'a', 'b', 'c', 'd', 'e', 'f' );
		fs.symlinkSync( path.join( outside, 'shared-plugin' ), path.join( deep, 'link' ) );

		return expect( collectSymlinkAllowlistEntries( sitePath ) ).resolves.toEqual( [] );
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

	it( 'honours an explicit depth limit', () => {
		const nested = makeDir( 'wp-content', 'plugins' );
		fs.symlinkSync( path.join( outside, 'shared-plugin' ), path.join( nested, 'shared-plugin' ) );

		return expect( collectSymlinkAllowlistEntries( sitePath, 2 ) ).resolves.toEqual( [] );
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
