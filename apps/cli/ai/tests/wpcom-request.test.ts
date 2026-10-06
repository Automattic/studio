import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	WPCOM_REQUEST_BODY_FILES_RELATIVE_DIR,
	wpcomRequestTool,
} from 'cli/ai/tools/wpcom-request';

const mocks = vi.hoisted( () => ( {
	req: {
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		del: vi.fn(),
	},
	readAuthToken: vi.fn(),
	configDirectory: '',
} ) );

vi.mock( '@studio/common/lib/wpcom-factory', () => ( {
	default: vi.fn( () => ( { req: mocks.req } ) ),
} ) );

vi.mock( '@studio/common/lib/wpcom-xhr-request-factory', () => ( {
	default: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/shared-config', () => ( {
	readAuthToken: mocks.readAuthToken,
} ) );

vi.mock( '@studio/common/lib/well-known-paths', () => ( {
	getConfigDirectory: () => mocks.configDirectory,
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
		mocks.readAuthToken.mockResolvedValue( { accessToken: 'token' } );
		mocks.configDirectory = rootDir;
	} );

	afterEach( async () => {
		await rm( rootDir, { recursive: true, force: true } );
	} );

	it( 'uses staged files for string fields and full JSON request bodies', async () => {
		const contentPath = `${ WPCOM_REQUEST_BODY_FILES_RELATIVE_DIR }/home.html`;
		await writeFile( path.join( rootDir, contentPath ), '<!-- wp:paragraph --><p>Hello</p>' );
		const bodyPath = `${ WPCOM_REQUEST_BODY_FILES_RELATIVE_DIR }/global-styles.json`;
		const globalStylesBody = {
			styles: {
				color: {
					background: '#111111',
				},
			},
		};
		await writeFile( path.join( rootDir, bodyPath ), JSON.stringify( globalStylesBody ) );

		const result = await wpcomRequestTool.rawHandler( {
			siteId: 123,
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

		mocks.req.post.mockClear();
		await wpcomRequestTool.rawHandler( {
			siteId: 123,
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

	it( 'needs a stored WordPress.com login', async () => {
		mocks.req.get.mockResolvedValue( [] );
		await wpcomRequestTool.rawHandler( { siteId: 456, method: 'GET', path: '/posts' } );
		expect( mocks.req.get ).toHaveBeenCalledWith( '/sites/456/posts', { apiNamespace: 'wp/v2' } );

		mocks.readAuthToken.mockResolvedValue( undefined );
		await expect(
			wpcomRequestTool.rawHandler( { siteId: 456, method: 'GET', path: '/posts' } )
		).rejects.toThrow( 'Not logged in to WordPress.com' );
	} );
} );
