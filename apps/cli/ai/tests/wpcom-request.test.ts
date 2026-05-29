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

		mocks.req.post.mockClear();
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
} );
