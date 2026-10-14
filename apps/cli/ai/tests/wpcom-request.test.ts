import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wpcomRequestTool } from 'cli/ai/tools/wpcom-request';

const mocks = vi.hoisted( () => ( {
	req: {
		post: vi.fn(),
	},
	readAuthToken: vi.fn(),
	payloadsDir: '',
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
	getAiPayloadsPath: () => mocks.payloadsDir,
} ) );

describe( 'wpcom_request', () => {
	beforeEach( async () => {
		vi.resetAllMocks();
		mocks.payloadsDir = await mkdtemp( path.join( os.tmpdir(), 'studio-wpcom-request-' ) );
		mocks.req.post.mockResolvedValue( { ok: true } );
		mocks.readAuthToken.mockResolvedValue( { accessToken: 'token' } );
	} );

	afterEach( async () => {
		await rm( mocks.payloadsDir, { recursive: true, force: true } );
	} );

	it( 'uses staged files, by relative or absolute path, for string fields and full JSON request bodies', async () => {
		await writeFile(
			path.join( mocks.payloadsDir, 'home.html' ),
			'<!-- wp:paragraph --><p>Hello</p>'
		);
		const bodyPath = path.join( mocks.payloadsDir, 'global-styles.json' );
		const globalStylesBody = {
			styles: {
				color: {
					background: '#111111',
				},
			},
		};
		await writeFile( bodyPath, JSON.stringify( globalStylesBody ) );

		const result = await wpcomRequestTool.rawHandler( {
			siteId: 123,
			method: 'POST',
			path: '/pages/4',
			body: { status: 'publish' },
			bodyFiles: { content: 'home.html' },
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
		mocks.readAuthToken.mockResolvedValue( undefined );
		await expect(
			wpcomRequestTool.rawHandler( { siteId: 456, method: 'GET', path: '/posts' } )
		).rejects.toThrow( 'Not logged in to WordPress.com' );
	} );
} );
