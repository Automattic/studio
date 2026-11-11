import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../functions/wpcom-backup/[site]/[download]/data';
import { downloadBackup } from './backup-download';

const MIB = 1024 * 1024;
const DOWNLOAD_URL =
	'https://public-api.wordpress.com/wpcom/v2/sites/12/rewind/downloads/34/data?token=secret';

// The page's `fetch` reaches the real worker, whose own `fetch` reaches a fake WordPress.com.
function serveBackup( archive: Uint8Array, cutChunks = 0 ) {
	const upstream: string[] = [];
	let cuts = cutChunks;
	const fetchMock = vi.fn( async ( input: string, init?: RequestInit ) => {
		if ( input.startsWith( '/wpcom-backup/' ) ) {
			const [ , , site, download ] = input.split( '/' );
			return GET( new Request( `https://app.test${ input }`, init ), {
				params: { site, download },
			} );
		}
		upstream.push( input );
		const [ , first, last ] = ( init?.headers as { Range: string } ).Range.match(
			/bytes=(\d+)-(\d+)/
		) as RegExpMatchArray;
		const end = Math.min( Number( last ), archive.length - 1 );
		const body = archive.slice( Number( first ), end + 1 );
		const headers = { 'content-range': `bytes ${ first }-${ end }/${ archive.length }` };
		if ( cuts-- > 0 ) {
			return new Response( body.slice( 0, 10 ), { status: 206, headers } );
		}
		return new Response( body, { status: 206, headers } );
	} );
	vi.stubGlobal( 'fetch', fetchMock );
	return { fetchMock, upstream };
}

const download = () =>
	downloadBackup( DOWNLOAD_URL, {
		signal: new AbortController().signal,
		onProgress: () => {},
	} );

describe( 'downloadBackup', () => {
	beforeEach( () => {
		vi.useFakeTimers();
	} );

	afterEach( () => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	} );

	it( 'reassembles an archive larger than a chunk, keeping the token out of the page URL', async () => {
		const archive = new Uint8Array( 17 * MIB ).fill( 7, 16 * MIB );
		const { fetchMock, upstream } = serveBackup( archive );

		expect( Buffer.compare( await download(), archive ) ).toBe( 0 );

		expect( upstream ).toHaveLength( 2 );
		expect( upstream[ 0 ] ).toContain( '/sites/12/rewind/downloads/34/data?token=secret' );
		const pageRequests = fetchMock.mock.calls.map( ( [ input ] ) => input );
		expect( pageRequests ).toContain( '/wpcom-backup/12/34/data' );
		expect( pageRequests.filter( ( input ) => input.startsWith( '/' ) ).join() ).not.toContain(
			'secret'
		);
	} );

	it( 'retries a chunk that arrives short', async () => {
		const archive = new Uint8Array( 1_000 ).fill( 7 );
		serveBackup( archive, 1 );

		const result = download();
		await vi.runAllTimersAsync();

		expect( await result ).toEqual( archive );
	} );

	it( 'gives up after repeated short chunks', async () => {
		serveBackup( new Uint8Array( 1_000 ), 3 );

		const result = download().catch( ( error ) => error );
		await vi.runAllTimersAsync();

		expect( await result ).toEqual( new Error( 'The backup could not be downloaded.' ) );
	} );

	it( 'refuses a request with no token or a malformed range', async () => {
		const context = { params: { site: '12', download: '34' } };

		const noToken = await GET( new Request( 'https://app.test/data' ), context );
		const badRange = await GET(
			new Request( 'https://app.test/data', {
				headers: { 'x-backup-token': 'secret', 'x-backup-range': 'bytes=0-1,5-9' },
			} ),
			context
		);

		expect( [ noToken.status, badRange.status ] ).toEqual( [ 400, 400 ] );
	} );
} );
