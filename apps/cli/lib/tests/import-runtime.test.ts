import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	downloadVerifiedAsset,
	publishStagedInstall,
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

let configDirectory: string;
beforeEach( () => {
	resetImportRuntimeCacheForTests();
	configDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-config-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', configDirectory );
} );
afterEach( () => {
	vi.unstubAllEnvs();
	fs.rmSync( configDirectory, { recursive: true, force: true } );
} );

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

	const release = {
		tag_name: 'v0.5.3',
		assets: [
			{
				name: 'data-liberation-0.5.3.tgz',
				browser_download_url: 'https://example.com/engine.tgz',
				digest: `sha256:${ digest( 'engine' ) }`,
			},
		],
	};
	const countingFetch = ( impl: typeof fetch ) => {
		const calls = { count: 0 };
		const wrapped = ( async ( ...args: Parameters< typeof fetch > ) => {
			calls.count++;
			return impl( ...args );
		} ) as typeof fetch;
		return { calls, fetch: wrapped };
	};

	it( 'shares a fresh lookup with other Studio processes', async () => {
		const first = countingFetch( releaseFetch( release ) );
		await resolveLatestReleaseAsset(
			'Automattic/data-liberation-agent',
			matchesEngine,
			first.fetch
		);
		// A second process starts with an empty in-memory cache.
		resetImportRuntimeCacheForTests();
		const second = countingFetch( releaseFetch( release ) );
		const asset = await resolveLatestReleaseAsset(
			'Automattic/data-liberation-agent',
			matchesEngine,
			second.fetch
		);
		expect( asset.version ).toBe( '0.5.3' );
		expect( second.calls.count ).toBe( 0 );
	} );

	it( 'uses the last verified release when GitHub rate-limits or is unreachable', async () => {
		await resolveLatestReleaseAsset(
			'Automattic/data-liberation-agent',
			matchesEngine,
			releaseFetch( release )
		);
		vi.useFakeTimers( { now: Date.now() + 60 * 60 * 1000 } );
		try {
			for ( const failing of [
				releaseFetch( {}, 403 ),
				( async () => {
					throw new TypeError( 'fetch failed' );
				} ) as unknown as typeof fetch,
			] ) {
				resetImportRuntimeCacheForTests();
				const asset = await resolveLatestReleaseAsset(
					'Automattic/data-liberation-agent',
					matchesEngine,
					failing
				);
				expect( asset.sha256 ).toBe( digest( 'engine' ) );
			}
		} finally {
			vi.useRealTimers();
		}
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

	it( 'lets concurrent downloads of the same asset both succeed', async () => {
		const destination = path.join( directory, 'ssi.zip' );
		const body = 'plugin-bytes-'.repeat( 4096 );
		// Chunked bodies interleave the two writes, as parallel imports do.
		const chunkedFetch = ( async () =>
			new Response(
				new ReadableStream( {
					async start( controller ) {
						for ( let i = 0; i < body.length; i += 1024 ) {
							controller.enqueue( new TextEncoder().encode( body.slice( i, i + 1024 ) ) );
							await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
						}
						controller.close();
					},
				} )
			) ) as unknown as typeof fetch;
		await Promise.all( [
			downloadVerifiedAsset( asset( digest( body ) ), destination, chunkedFetch ),
			downloadVerifiedAsset( asset( digest( body ) ), destination, chunkedFetch ),
		] );
		expect( fs.readFileSync( destination, 'utf8' ) ).toBe( body );
		expect( fs.readdirSync( directory ) ).toEqual( [ 'ssi.zip' ] );
	} );
} );

describe( 'publishStagedInstall', () => {
	let directory: string;
	beforeEach( () => {
		directory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-runtime-' ) );
	} );
	afterEach( () => fs.rmSync( directory, { recursive: true, force: true } ) );

	const isComplete = ( dir: string ) => fs.existsSync( path.join( dir, 'bundle.mjs' ) );
	const stage = ( name: string, marker: string ) => {
		const staging = path.join( directory, name );
		fs.mkdirSync( staging );
		fs.writeFileSync( path.join( staging, 'bundle.mjs' ), marker );
		return staging;
	};

	it( 'publishes a staged install', () => {
		const target = path.join( directory, '0.5.3' );
		publishStagedInstall( stage( 'a', 'A' ), target, isComplete );
		expect( fs.readFileSync( path.join( target, 'bundle.mjs' ), 'utf8' ) ).toBe( 'A' );
	} );

	it( 'keeps the first complete install when another process publishes second', () => {
		const target = path.join( directory, '0.5.3' );
		const first = stage( 'first', 'first' );
		const second = stage( 'second', 'second' );
		publishStagedInstall( first, target, isComplete );
		const inUse = fs.statSync( path.join( target, 'bundle.mjs' ) ).ino;

		publishStagedInstall( second, target, isComplete );

		// The running import's files are untouched and the loser cleaned up.
		expect( fs.readFileSync( path.join( target, 'bundle.mjs' ), 'utf8' ) ).toBe( 'first' );
		expect( fs.statSync( path.join( target, 'bundle.mjs' ) ).ino ).toBe( inUse );
		expect( fs.readdirSync( directory ) ).toEqual( [ '0.5.3' ] );
	} );

	it( 'replaces an incomplete directory left at the target', () => {
		const target = path.join( directory, '0.5.3' );
		fs.mkdirSync( path.join( target, 'dist' ), { recursive: true } );
		publishStagedInstall( stage( 'a', 'A' ), target, isComplete );
		expect( fs.readFileSync( path.join( target, 'bundle.mjs' ), 'utf8' ) ).toBe( 'A' );
		expect( fs.readdirSync( directory ) ).toEqual( [ '0.5.3' ] );
	} );
} );
