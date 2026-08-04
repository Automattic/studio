import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { containsPath, foldContainedPaths } from '../native-php/open-basedir';

const p = ( ...segments: string[] ) => path.join( path.sep, ...segments );

describe( 'containsPath', () => {
	it( 'treats a path as containing itself', () => {
		expect( containsPath( p( 'site' ), p( 'site' ) ) ).toBe( true );
	} );

	it( 'matches a nested path', () => {
		expect( containsPath( p( 'site' ), p( 'site', 'wp-content', 'plugins' ) ) ).toBe( true );
	} );

	it( 'does not match a sibling that shares a prefix', () => {
		expect( containsPath( p( 'site' ), p( 'site-backup' ) ) ).toBe( false );
	} );

	it( 'does not match upwards', () => {
		expect( containsPath( p( 'site', 'wp-content' ), p( 'site' ) ) ).toBe( false );
	} );

	it( 'ignores a trailing separator on the parent', () => {
		expect( containsPath( `${ p( 'site' ) }${ path.sep }`, p( 'site', 'wp-content' ) ) ).toBe(
			true
		);
	} );
} );

describe( 'foldContainedPaths', () => {
	it( 'drops entries nested inside another entry', () => {
		expect(
			foldContainedPaths( [
				p( 'site' ),
				p( 'site', 'wp-content', 'plugins', 'foo' ),
				p( 'site', 'wp-content', 'themes', 'bar' ),
			] )
		).toEqual( [ p( 'site' ) ] );
	} );

	it( 'keeps entries outside the site directory', () => {
		expect(
			foldContainedPaths( [ p( 'site' ), p( 'site', 'wp-content' ), p( 'shared', 'plugin' ) ] )
		).toEqual( [ p( 'site' ), p( 'shared', 'plugin' ) ] );
	} );

	it( 'deduplicates entries that differ only by trailing separator', () => {
		expect( foldContainedPaths( [ p( 'tmp' ), `${ p( 'tmp' ) }${ path.sep }` ] ) ).toEqual( [
			p( 'tmp' ),
		] );
	} );

	it( 'folds a deep link farm down to the site directory', () => {
		const nested = Array.from( { length: 500 }, ( _, index ) =>
			p( 'site', 'wp-content', 'themes', 'x', 'node_modules', '.pnpm', `pkg-${ index }` )
		);
		expect( foldContainedPaths( [ p( 'site' ), ...nested ] ) ).toEqual( [ p( 'site' ) ] );
	} );

	it( 'collapses redundant segments in the entries it emits', () => {
		expect( foldContainedPaths( [ p( 'site', 'wp-content', '..', 'other' ) ] ) ).toEqual( [
			p( 'site', 'other' ),
		] );
	} );

	it( 'ignores empty entries', () => {
		expect( foldContainedPaths( [ '', p( 'site' ) ] ) ).toEqual( [ p( 'site' ) ] );
	} );

	it( 'is order independent', () => {
		const entries = [ p( 'site', 'wp-content' ), p( 'shared' ), p( 'site' ) ];
		expect( foldContainedPaths( entries ).sort() ).toEqual(
			foldContainedPaths( [ ...entries ].reverse() ).sort()
		);
	} );
} );

// The cases above use paths that do not exist, so arePathsEqual falls back to
// string comparison. These exercise the on-disk comparison it prefers.
describe( 'containsPath against a real filesystem', () => {
	let root: string;
	let site: string;

	beforeAll( () => {
		root = fs.realpathSync( fs.mkdtempSync( path.join( os.tmpdir(), 'studio-open-basedir-' ) ) );
		site = path.join( root, 'Site' );
		fs.mkdirSync( path.join( site, 'wp-content', 'plugins' ), { recursive: true } );
	} );

	afterAll( () => {
		fs.rmSync( root, { recursive: true, force: true } );
	} );

	it( 'sees through a symlinked ancestor', () => {
		const link = path.join( root, 'linked-site' );
		fs.symlinkSync( site, link, 'junction' );

		expect( containsPath( site, path.join( link, 'wp-content', 'plugins' ) ) ).toBe( true );
	} );

	it( 'follows the volume on casing rather than the platform', () => {
		const differentCase = path.join( root, 'site' );
		// Ask the filesystem directly instead of inferring from process.platform:
		// macOS is usually case-insensitive and Linux usually is not, but either can
		// be mounted the other way.
		const volumeIsCaseInsensitive = fs.existsSync( differentCase );

		expect( containsPath( differentCase, path.join( site, 'wp-content' ) ) ).toBe(
			volumeIsCaseInsensitive
		);
	} );

	it( 'still rejects a sibling that shares a prefix', () => {
		const sibling = path.join( root, 'Site-backup' );
		fs.mkdirSync( sibling, { recursive: true } );

		expect( containsPath( site, sibling ) ).toBe( false );
	} );
} );
