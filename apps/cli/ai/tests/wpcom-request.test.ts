import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createWpcomRequestTool,
	WPCOM_REQUEST_BODY_FILES_RELATIVE_DIR,
} from 'cli/ai/tools/wpcom-request';

const mocks = vi.hoisted( () => ( {
	req: {
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		del: vi.fn(),
	},
} ) );

vi.mock( '@studio/common/lib/wpcom-factory', () => ( {
	default: vi.fn( () => ( { req: mocks.req } ) ),
} ) );

vi.mock( '@studio/common/lib/wpcom-xhr-request-factory', () => ( {
	default: vi.fn(),
} ) );

describe( 'wpcom_request', () => {
	let rootDir: string;

	beforeEach( async () => {
		vi.resetAllMocks();
		rootDir = await mkdtemp( path.join( os.tmpdir(), 'studio-wpcom-request-' ) );
		await mkdir( path.join( rootDir, WPCOM_REQUEST_BODY_FILES_RELATIVE_DIR ), {
			recursive: true,
		} );
		mocks.req.post.mockResolvedValue( { ok: true } );
	} );

	afterEach( async () => {
		await rm( rootDir, { recursive: true, force: true } );
	} );

	it( 'merges bodyFiles into the REST request body', async () => {
		const contentPath = `${ WPCOM_REQUEST_BODY_FILES_RELATIVE_DIR }/home.html`;
		await writeFile( path.join( rootDir, contentPath ), '<!-- wp:paragraph --><p>Hello</p>' );

		const tool = createWpcomRequestTool( 'token', 123, { bodyFilesRoot: rootDir } );
		const result = await tool.rawHandler( {
			method: 'POST',
			path: '/pages/4',
			body: { status: 'publish' },
			bodyFiles: { content: contentPath },
		} );

		expect( mocks.req.post ).toHaveBeenCalledWith(
			'/sites/123/pages/4',
			{ apiNamespace: 'wp/v2' },
			{
				status: 'publish',
				content: '<!-- wp:paragraph --><p>Hello</p>',
			}
		);
		expect( result.content[ 0 ] ).toEqual( { type: 'text', text: '{"ok":true}' } );
	} );

	it( 'uses bodyFile as the full parsed JSON request body', async () => {
		const bodyPath = `${ WPCOM_REQUEST_BODY_FILES_RELATIVE_DIR }/global-styles.json`;
		const globalStylesBody = {
			styles: {
				color: {
					background: '#111111',
					text: '#f5f0e8',
				},
			},
			settings: {
				color: {
					palette: [
						{
							slug: 'espresso',
							color: '#111111',
							name: 'Espresso',
						},
					],
				},
			},
		};
		await writeFile( path.join( rootDir, bodyPath ), JSON.stringify( globalStylesBody ) );

		const tool = createWpcomRequestTool( 'token', 123, { bodyFilesRoot: rootDir } );
		await tool.rawHandler( {
			method: 'POST',
			path: '/global-styles/7',
			bodyFile: bodyPath,
		} );

		expect( mocks.req.post ).toHaveBeenCalledWith(
			'/sites/123/global-styles/7',
			{ apiNamespace: 'wp/v2' },
			globalStylesBody
		);
	} );

	it( 'rejects absolute bodyFiles paths', async () => {
		const tool = createWpcomRequestTool( 'token', 123, { bodyFilesRoot: rootDir } );

		await expect(
			tool.rawHandler( {
				method: 'POST',
				path: '/pages/4',
				bodyFiles: {
					content: path.join( rootDir, WPCOM_REQUEST_BODY_FILES_RELATIVE_DIR, 'home.html' ),
				},
			} )
		).rejects.toThrow( /relative paths under \.studio-agent\/payloads/ );
		expect( mocks.req.post ).not.toHaveBeenCalled();
	} );

	it( 'rejects bodyFiles path traversal outside the payload directory', async () => {
		const tool = createWpcomRequestTool( 'token', 123, { bodyFilesRoot: rootDir } );

		await expect(
			tool.rawHandler( {
				method: 'POST',
				path: '/pages/4',
				bodyFiles: {
					content: `${ WPCOM_REQUEST_BODY_FILES_RELATIVE_DIR }/../secret.html`,
				},
			} )
		).rejects.toThrow( /relative paths under \.studio-agent\/payloads/ );
		expect( mocks.req.post ).not.toHaveBeenCalled();
	} );

	it( 'rejects conflicts between inline and file-backed body fields', async () => {
		const contentPath = `${ WPCOM_REQUEST_BODY_FILES_RELATIVE_DIR }/home.html`;
		await writeFile( path.join( rootDir, contentPath ), '<!-- wp:paragraph --><p>Hello</p>' );
		const tool = createWpcomRequestTool( 'token', 123, { bodyFilesRoot: rootDir } );

		await expect(
			tool.rawHandler( {
				method: 'POST',
				path: '/pages/4',
				body: { content: 'inline' },
				bodyFiles: { content: contentPath },
			} )
		).rejects.toThrow( /defines both body\.content and bodyFiles\.content/ );
		expect( mocks.req.post ).not.toHaveBeenCalled();
	} );

	it( 'rejects combining bodyFile with another request body source', async () => {
		const bodyPath = `${ WPCOM_REQUEST_BODY_FILES_RELATIVE_DIR }/global-styles.json`;
		await writeFile( path.join( rootDir, bodyPath ), JSON.stringify( { styles: {} } ) );
		const tool = createWpcomRequestTool( 'token', 123, { bodyFilesRoot: rootDir } );

		await expect(
			tool.rawHandler( {
				method: 'POST',
				path: '/global-styles/7',
				body: { title: 'Global Styles' },
				bodyFile: bodyPath,
			} )
		).rejects.toThrow( /Use only one request body source/ );
		expect( mocks.req.post ).not.toHaveBeenCalled();
	} );

	it( 'rejects filename-like bodyFiles keys before making the REST request', async () => {
		const contentPath = `${ WPCOM_REQUEST_BODY_FILES_RELATIVE_DIR }/styles.css`;
		await writeFile( path.join( rootDir, contentPath ), 'body { color: red; }' );
		const tool = createWpcomRequestTool( 'token', 123, { bodyFilesRoot: rootDir } );

		await expect(
			tool.rawHandler( {
				method: 'POST',
				path: '/global-styles/2',
				bodyFiles: { 'styles.css': contentPath },
			} )
		).rejects.toThrow( /top-level REST body field names/ );
		expect( mocks.req.post ).not.toHaveBeenCalled();
	} );
} );
