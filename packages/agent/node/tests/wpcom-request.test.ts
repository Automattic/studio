import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindTool } from '@studio/agent/node/tools/define-tool';
import { createWpcomRequestTool } from '@studio/agent/node/tools/wpcom-request';
import { createFakeHost } from './fake-host';
import type { StudioAgentHost } from '@studio/agent/node/host';

describe( 'wpcom_request', () => {
	let payloadsDir: string;
	let host: StudioAgentHost;
	let wpcomRequest: ReturnType<
		typeof bindTool< ReturnType< typeof createWpcomRequestTool >[ 'parameters' ][ 'properties' ] >
	>;

	beforeEach( async () => {
		payloadsDir = await mkdtemp( path.join( os.tmpdir(), 'studio-wpcom-request-' ) );
		const fakeHost = createFakeHost();
		host = { ...fakeHost, wpcom: { ...fakeHost.wpcom, payloadsDirectory: payloadsDir } };
		vi.mocked( host.wpcom.request ).mockResolvedValue( { ok: true } );
		wpcomRequest = bindTool( createWpcomRequestTool( payloadsDir ), host );
	} );

	afterEach( async () => {
		await rm( payloadsDir, { recursive: true, force: true } );
	} );

	it( 'uses staged files, by relative or absolute path, for string fields and full JSON request bodies', async () => {
		await writeFile( path.join( payloadsDir, 'home.html' ), '<!-- wp:paragraph --><p>Hello</p>' );
		const bodyPath = path.join( payloadsDir, 'global-styles.json' );
		const globalStylesBody = {
			styles: {
				color: {
					background: '#111111',
				},
			},
		};
		await writeFile( bodyPath, JSON.stringify( globalStylesBody ) );

		const result = await wpcomRequest.rawHandler( {
			siteId: 123,
			method: 'POST',
			path: '/pages/4',
			body: { status: 'publish' },
			bodyFiles: { content: 'home.html' },
		} );

		expect( host.wpcom.request ).toHaveBeenCalledWith(
			'POST',
			'/sites/123/pages/4',
			{ apiNamespace: 'wp/v2' },
			{
				status: 'publish',
				content: '<!-- wp:paragraph --><p>Hello</p>',
			}
		);
		expect( result.content[ 0 ] ).toEqual( { type: 'text', text: '{"ok":true}' } );

		vi.mocked( host.wpcom.request ).mockClear();
		await wpcomRequest.rawHandler( {
			siteId: 123,
			method: 'POST',
			path: '/global-styles/7',
			bodyFile: bodyPath,
		} );

		expect( host.wpcom.request ).toHaveBeenCalledWith(
			'POST',
			'/sites/123/global-styles/7',
			{ apiNamespace: 'wp/v2' },
			globalStylesBody
		);
	} );

	it( "keeps the site plan's active features and drops the catalogue of other plans' features", async () => {
		vi.mocked( host.wpcom.request ).mockResolvedValue( {
			ID: 123,
			plan: {
				product_slug: 'free_plan',
				product_name_short: 'Free',
				is_free: true,
				features: {
					active: [ 'free-blog', 'stats-basic' ],
					available: { 'custom-design': [ 'value_bundle', 'business-bundle' ] },
				},
			},
		} );

		const result = await wpcomRequest.rawHandler( {
			siteId: 123,
			method: 'GET',
			path: '/',
			apiNamespace: '',
		} );

		const site = JSON.parse( ( result.content[ 0 ] as { text: string } ).text );
		expect( site.plan.features ).toEqual( { active: [ 'free-blog', 'stats-basic' ] } );
		expect( site.plan.product_slug ).toBe( 'free_plan' );
	} );
} );
