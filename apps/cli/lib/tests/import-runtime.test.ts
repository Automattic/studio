import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	downloadVerifiedAsset,
	resetImportRuntimeCacheForTests,
	resolveLatestReleaseAsset,
	type ReleaseAsset,
} from '../import-runtime';

const digest = ( body: string ) => crypto.createHash( 'sha256' ).update( body ).digest( 'hex' );

function releaseFetch( release: unknown, status = 200 ): typeof fetch {
	return ( async () =>
		new Response( JSON.stringify( release ), { status } ) ) as unknown as typeof fetch;
}

const matchesEngine = ( name: string, version: string ) =>
	name === `data-liberation-${ version }.tgz`;

beforeEach( () => resetImportRuntimeCacheForTests() );

describe( 'resolveLatestReleaseAsset', () => {
	it( 'returns the matching asset with its published digest', async () => {
		const sha = digest( 'engine' );
		const asset = await resolveLatestReleaseAsset(
			'Automattic/data-liberation-agent',
			matchesEngine,
			releaseFetch( {
				tag_name: 'v0.4.22',
				assets: [
					{
						name: 'data-liberation-0.4.22.tgz',
						browser_download_url: 'https://example.com/engine.tgz',
						digest: `sha256:${ sha }`,
					},
				],
			} )
		);
		expect( asset ).toEqual( {
			repo: 'Automattic/data-liberation-agent',
			version: '0.4.22',
			name: 'data-liberation-0.4.22.tgz',
			url: 'https://example.com/engine.tgz',
			sha256: sha,
		} );
	} );

	it( 'refuses a release without a verifiable asset instead of falling back', async () => {
		await expect(
			resolveLatestReleaseAsset(
				'Automattic/data-liberation-agent',
				matchesEngine,
				releaseFetch( {
					tag_name: 'v0.4.22',
					assets: [ { name: 'data-liberation-0.4.22.tgz', browser_download_url: 'https://x' } ],
				} )
			)
		).rejects.toThrow( /missing its verifiable runtime asset/ );
	} );

	it( 'refuses a prerelease tag', async () => {
		await expect(
			resolveLatestReleaseAsset(
				'Automattic/data-liberation-agent',
				matchesEngine,
				releaseFetch( { tag_name: 'v0.5.0-beta.1', assets: [] } )
			)
		).rejects.toThrow( /has no stable release/ );
	} );

	it( 'reports a failed lookup', async () => {
		await expect(
			resolveLatestReleaseAsset(
				'Automattic/data-liberation-agent',
				matchesEngine,
				releaseFetch( {}, 403 )
			)
		).rejects.toThrow( /latest release lookup failed \(HTTP 403\)/ );
	} );
} );

describe( 'downloadVerifiedAsset', () => {
	let directory: string;
	beforeEach( () => {
		directory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-runtime-' ) );
	} );
	afterEach( () => fs.rmSync( directory, { recursive: true, force: true } ) );

	const asset = ( sha256: string ): ReleaseAsset => ( {
		repo: 'Automattic/static-site-importer',
		version: '1.14.6',
		name: 'static-site-importer-html-site-import.zip',
		url: 'https://example.com/ssi.zip',
		sha256,
	} );
	const bodyFetch = ( body: string ) =>
		( async () => new Response( body ) ) as unknown as typeof fetch;

	it( 'writes bytes that match the digest', async () => {
		const destination = path.join( directory, 'ssi.zip' );
		await downloadVerifiedAsset( asset( digest( 'plugin' ) ), destination, bodyFetch( 'plugin' ) );
		expect( fs.readFileSync( destination, 'utf8' ) ).toBe( 'plugin' );
	} );

	it( 'refuses bytes that do not match the digest and leaves nothing behind', async () => {
		const destination = path.join( directory, 'ssi.zip' );
		await expect(
			downloadVerifiedAsset( asset( digest( 'plugin' ) ), destination, bodyFetch( 'tampered' ) )
		).rejects.toThrow( /does not match its published SHA-256 digest/ );
		expect( fs.readdirSync( directory ) ).toEqual( [] );
	} );
} );
