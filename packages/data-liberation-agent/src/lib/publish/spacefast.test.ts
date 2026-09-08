import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectDirectoryEntries, spacefastTarget } from './spacefast.js';
import { PublishError } from './types.js';

const dirs: string[] = [];

function site(): string {
	const dir = mkdtempSync( join( tmpdir(), 'dla-publish-' ) );
	dirs.push( dir );
	writeFileSync( join( dir, 'index.html' ), '<h1>Home</h1>' );
	mkdirSync( join( dir, 'blog' ), { recursive: true } );
	writeFileSync( join( dir, 'blog', 'post.html' ), '<h1>Post</h1>' );
	return dir;
}

const receipt = {
	data: {
		space: { id: 'spc_1', liveUrl: 'https://example.view.fast/' },
		version: { immutableUrl: 'https://v1--example.view.fast/', number: 1 },
		activation: { outcome: 'activated' },
		next: { action: 'done', hint: 'Live. Nothing left to do.' },
		claim: { claimUrl: 'https://my.spacefast.com/claim#sfc_x', expiresAt: '2026-08-27T09:20:12.833Z' },
	},
};

function stubFetch( status: number, body: unknown ) {
	const fetchMock = vi.fn(
		async ( _url: string, _init: RequestInit ) =>
			new Response( typeof body === 'string' ? body : JSON.stringify( body ), { status } )
	);
	vi.stubGlobal( 'fetch', fetchMock );
	return fetchMock;
}

beforeEach( () => vi.unstubAllGlobals() );
afterEach( () => {
	vi.unstubAllGlobals();
	for ( const dir of dirs.splice( 0 ) ) rmSync( dir, { recursive: true, force: true } );
} );

describe( 'collectDirectoryEntries', () => {
	it( 'collects nested files with POSIX archive paths', () => {
		expect( collectDirectoryEntries( site() ).map( ( entry ) => entry.path ) ).toEqual( [
			'blog/post.html',
			'index.html',
		] );
	} );
} );

describe( 'spacefastTarget', () => {
	it( 'uploads the site as an archive and reports where it went live', async () => {
		const fetchMock = stubFetch( 201, receipt );

		const result = await spacefastTarget.publish( { directory: site() } );

		expect( result ).toMatchObject( {
			target: 'spacefast',
			liveUrl: 'https://example.view.fast/',
			versionUrl: 'https://v1--example.view.fast/',
			files: 2,
			private: true,
			claim: { url: 'https://my.spacefast.com/claim#sfc_x' },
			notes: [],
		} );

		const [ url, init ] = fetchMock.mock.calls[ 0 ]!;
		expect( url ).toBe( 'https://api.spacefast.com/v1/publish' );
		expect( init.method ).toBe( 'POST' );
		expect( ( init.headers as Record< string, string > ).authorization ).toBeUndefined();

		// The archive must be a real zip carrying the site's paths.
		const archive = Buffer.from(
			await ( ( init.body as FormData ).get( 'archive' ) as Blob ).arrayBuffer()
		);
		const zipPath = join( dirs[ 0 ]!, 'sent.zip' );
		writeFileSync( zipPath, archive );
		const listed = execFileSync( 'python3', [
			'-c',
			'import sys, zipfile; print("\\n".join(sorted(zipfile.ZipFile(sys.argv[1]).namelist())))',
			zipPath,
		] )
			.toString()
			.trim()
			.split( '\n' );
		expect( listed ).toEqual( [ 'blog/post.html', 'index.html' ] );
	} );

	it( 'sends the token for an owned publish', async () => {
		const fetchMock = stubFetch( 201, receipt );
		await spacefastTarget.publish( { directory: site(), token: 'sfc_secret' } );
		const [ , init ] = fetchMock.mock.calls[ 0 ]!;
		expect( ( init.headers as Record< string, string > ).authorization ).toBe( 'Bearer sfc_secret' );
	} );

	it( 'reports a pending activation instead of implying the site is serving', async () => {
		stubFetch( 201, {
			data: {
				...receipt.data,
				activation: { outcome: 'pending' },
				next: { action: 'poll', hint: 'Still building.' },
			},
		} );
		const result = await spacefastTarget.publish( { directory: site() } );
		expect( result.notes ).toEqual( [
			'activation pending',
			'next step poll: Still building.',
		] );
	} );

	it( 'surfaces the stable problem code and request id on failure', async () => {
		stubFetch( 403, {
			type: 'https://spacefast.com/docs/errors/access_denied',
			title: 'Access denied',
			status: 403,
			detail: 'This token cannot access that space.',
			code: 'access_denied',
			requestId: 'req_4mz0v8qk',
		} );

		await expect( spacefastTarget.publish( { directory: site() } ) ).rejects.toMatchObject( {
			code: 'access_denied',
			requestId: 'req_4mz0v8qk',
		} );
	} );

	it( 'refuses to publish an empty directory', async () => {
		const empty = mkdtempSync( join( tmpdir(), 'dla-publish-' ) );
		dirs.push( empty );
		await expect( spacefastTarget.publish( { directory: empty } ) ).rejects.toBeInstanceOf(
			PublishError
		);
	} );

	it( 'fails loudly when a receipt carries no live URL', async () => {
		stubFetch( 201, { data: { space: {} } } );
		await expect( spacefastTarget.publish( { directory: site() } ) ).rejects.toMatchObject( {
			code: 'receipt_missing_live_url',
		} );
	} );
} );
