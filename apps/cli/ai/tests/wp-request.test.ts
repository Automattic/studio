import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWpRequestTool, WP_REQUEST_BODY_FILES_RELATIVE_DIR } from 'cli/ai/tools/wp-request';

function jsonResponse( body: unknown, init: { status?: number; statusText?: string } = {} ) {
	return new Response( JSON.stringify( body ), {
		status: init.status ?? 200,
		statusText: init.statusText ?? 'OK',
		headers: { 'Content-Type': 'application/json' },
	} );
}

describe( 'wp_request', () => {
	let rootDir: string;
	let fetchMock: ReturnType< typeof vi.fn >;

	const createTool = ( restRoot = 'https://example.com/wp-json/' ) =>
		createWpRequestTool( 'https://example.com/', 'admin', 'abcd efgh ijkl', restRoot, {
			bodyFilesRoot: rootDir,
			fetchImplementation: fetchMock as unknown as typeof fetch,
		} );

	beforeEach( async () => {
		// A Response body can only be read once, so build a fresh one per call.
		fetchMock = vi.fn().mockImplementation( () => Promise.resolve( jsonResponse( { ok: true } ) ) );
		rootDir = await mkdtemp( path.join( os.tmpdir(), 'studio-wp-request-' ) );
		await mkdir( path.join( rootDir, WP_REQUEST_BODY_FILES_RELATIVE_DIR ), {
			recursive: true,
		} );
	} );

	afterEach( async () => {
		await rm( rootDir, { recursive: true, force: true } );
	} );

	it( 'calls the wp/v2 namespace with Basic Auth and query parameters', async () => {
		fetchMock.mockResolvedValue( jsonResponse( [ { id: 1 } ] ) );

		const tool = createTool();
		const result = await tool.rawHandler( {
			method: 'GET',
			path: '/posts',
			query: { per_page: 5, status: 'publish' },
		} );

		expect( fetchMock ).toHaveBeenCalledWith(
			'https://example.com/wp-json/wp/v2/posts?per_page=5&status=publish',
			expect.objectContaining( {
				method: 'GET',
				headers: expect.objectContaining( {
					Authorization: `Basic ${ Buffer.from( 'admin:abcd efgh ijkl' ).toString( 'base64' ) }`,
				} ),
			} )
		);
		expect( result.content[ 0 ] ).toEqual( { type: 'text', text: '[{"id":1}]' } );
	} );

	it( 'supports plugin REST namespaces', async () => {
		const tool = createTool();
		await tool.rawHandler( { method: 'GET', path: '/products', apiNamespace: 'wc/v3' } );

		expect( fetchMock ).toHaveBeenCalledWith(
			'https://example.com/wp-json/wc/v3/products',
			expect.anything()
		);
	} );

	it( 'targets the ?rest_route= fallback root for plain-permalink sites', async () => {
		fetchMock.mockResolvedValue( jsonResponse( [ { id: 1 } ] ) );

		const tool = createTool( 'https://example.com/?rest_route=/' );
		await tool.rawHandler( {
			method: 'GET',
			path: '/posts',
			query: { per_page: 5 },
		} );

		expect( fetchMock ).toHaveBeenCalledWith(
			'https://example.com/?rest_route=%2Fwp%2Fv2%2Fposts&per_page=5',
			expect.anything()
		);
	} );

	it( 'uses staged files for string fields and full JSON request bodies', async () => {
		const contentPath = `${ WP_REQUEST_BODY_FILES_RELATIVE_DIR }/home.html`;
		await writeFile( path.join( rootDir, contentPath ), '<!-- wp:paragraph --><p>Hello</p>' );
		const bodyPath = `${ WP_REQUEST_BODY_FILES_RELATIVE_DIR }/global-styles.json`;
		const globalStylesBody = { styles: { color: { background: '#111111' } } };
		await writeFile( path.join( rootDir, bodyPath ), JSON.stringify( globalStylesBody ) );

		const tool = createTool();
		await tool.rawHandler( {
			method: 'POST',
			path: '/pages/4',
			body: { status: 'publish' },
			bodyFiles: { content: contentPath },
		} );

		expect( fetchMock ).toHaveBeenCalledWith(
			'https://example.com/wp-json/wp/v2/pages/4',
			expect.objectContaining( {
				method: 'POST',
				body: JSON.stringify( {
					status: 'publish',
					content: '<!-- wp:paragraph --><p>Hello</p>',
				} ),
			} )
		);

		fetchMock.mockClear();
		await tool.rawHandler( {
			method: 'POST',
			path: '/global-styles/7',
			bodyFile: bodyPath,
		} );

		expect( fetchMock ).toHaveBeenCalledWith(
			'https://example.com/wp-json/wp/v2/global-styles/7',
			expect.objectContaining( { body: JSON.stringify( globalStylesBody ) } )
		);
	} );

	it( 'rejects staged bodies on GET requests', async () => {
		const tool = createTool();
		await expect(
			tool.rawHandler( {
				method: 'GET',
				path: '/posts',
				bodyFile: `${ WP_REQUEST_BODY_FILES_RELATIVE_DIR }/body.json`,
			} )
		).rejects.toThrow( 'bodyFile and bodyFiles can only be used with POST or PUT requests.' );
		expect( fetchMock ).not.toHaveBeenCalled();
	} );

	it( 'surfaces REST error responses with status and body', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(
				{ code: 'rest_forbidden', message: 'Sorry, you are not allowed to do that.' },
				{ status: 403, statusText: 'Forbidden' }
			)
		);

		const tool = createTool();
		await expect( tool.rawHandler( { method: 'DELETE', path: '/posts/9' } ) ).rejects.toThrow(
			/DELETE \/posts\/9.*403 Forbidden[\s\S]*rest_forbidden/
		);
	} );
} );
