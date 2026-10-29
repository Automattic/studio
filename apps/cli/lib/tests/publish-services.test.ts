import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	assertAnonymousVisibility,
	contentFingerprint,
	createPublishServices,
} from '../publish-services';

const { get, launch } = vi.hoisted( () => ( { get: vi.fn(), launch: vi.fn() } ) );
vi.mock( 'playwright', () => ( { chromium: { launch } } ) );
vi.mock( '@studio/common/lib/shared-config', () => ( {
	readAuthToken: async () => ( { accessToken: 'test' } ),
} ) );
vi.mock( '@studio/common/lib/wpcom-factory', () => ( { default: () => ( { req: { get } } ) } ) );
vi.mock( 'cli/commands/push', () => ( { runCommand: vi.fn() } ) );
const remote = { id: 908, url: 'https://example.wpcomstaging.com' };
const metadata = {
	ID: 908,
	URL: remote.url,
	is_private: false,
	is_coming_soon: true,
	launch_status: 'unlaunched',
	options: { blog_public: 0 },
};
const visibility = {
	...remote,
	private: false,
	comingSoon: true,
	blogPublic: 0,
	launchStatus: 'unlaunched',
};
beforeEach( () => get.mockReset() );
const folders: string[] = [];
afterEach( () => {
	for ( const folder of folders.splice( 0 ) ) fs.rmSync( folder, { recursive: true, force: true } );
} );
function anonymousBrowser( contents: Record< string, string > ) {
	const pages: Array< {
		goto: ReturnType< typeof vi.fn >;
		screenshot: ReturnType< typeof vi.fn >;
	} > = [];
	const closes: Array< ReturnType< typeof vi.fn > > = [];
	const browser = {
		close: vi.fn(),
		newContext: vi.fn( async () => {
			let url = '',
				body = '';
			const page = {
				goto: vi.fn( async ( value: string ) => {
					url = value;
					body = contents[ new URL( value ).pathname ] ?? '';
					return { status: () => 200 };
				} ),
				screenshot: vi.fn(),
				locator: () => ( { textContent: async () => body, innerText: async () => body } ),
				evaluate: async ( _fn: unknown, args: { mediaFiles: string[] } ) => ( {
					barrier: body.includes( 'wpcom-coming-soon-body' ) ? 'coming-soon' : null,
					mediaVisible: args.mediaFiles.some( ( file ) => body.includes( file ) ),
				} ),
				url: () => url,
			};
			pages.push( page );
			const close = vi.fn();
			closes.push( close );
			return { newPage: async () => page, close };
		} ),
	};
	launch.mockResolvedValue( browser );
	return { browser, pages, closes };
}
describe( 'publication service contracts', () => {
	it( 'checks secondary pages and rejects exposed content behind a Coming Soon footer', async () => {
		const f = anonymousBrowser( {
			'/': '<body class="wpcom-coming-soon-body">Coming Soon</body>',
			'/details/': 'Private product information for the second page. Coming Soon',
		} );
		const directory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-access-test-' ) );
		folders.push( directory );
		const services = await createPublishServices( '/tmp/source-site' );
		await expect(
			services.verifyAccess(
				remote,
				{
					pages: [
						{
							slug: 'details',
							url: remote.url + '/details/',
							title: 'Details',
							hash: 'abc',
							probe: 'Privateproductinformationforthesecondpage.',
						},
					],
					media: [],
				},
				visibility,
				directory
			)
		).rejects.toThrow( 'Restricted site content' );
		expect( f.pages ).toHaveLength( 2 );
		for ( const page of f.pages )
			expect(
				new URL( page.goto.mock.calls[ 0 ][ 0 ] ).searchParams.get( 'studio-access-check' )
			).toBeTruthy();
		expect( f.browser.close ).toHaveBeenCalledOnce();
		for ( const close of f.closes ) expect( close ).toHaveBeenCalledOnce();
	} );
	it( 'rejects access checks outside the selected site', async () => {
		const f = anonymousBrowser( {
			'/': '<body class="wpcom-coming-soon-body">Coming Soon</body>',
		} );
		const directory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-access-test-' ) );
		folders.push( directory );
		const services = await createPublishServices( '/tmp/source-site' );
		await expect(
			services.verifyAccess(
				remote,
				{
					pages: [
						{
							slug: 'details',
							url: 'https://other.example/details',
							title: 'Details',
							hash: 'abc',
						},
					],
					media: [],
				},
				visibility,
				directory
			)
		).rejects.toThrow( 'outside the selected destination' );
		expect( f.pages ).toHaveLength( 1 );
	} );
	it( 'selects the destination before parsing unrelated metadata', async () => {
		get.mockResolvedValue( { sites: [ { ID: 12, launch_status: false }, metadata ] } );
		const services = await createPublishServices( '/tmp/source-site' );
		expect( await services.snapshot( remote ) ).toEqual( visibility );
		expect( get.mock.calls[ 0 ][ 0 ] ).toEqual( { apiNamespace: 'rest/v1.2', path: '/me/sites' } );
	} );
	it( 'rejects incomplete visibility rather than guessing noindex', async () => {
		get.mockResolvedValue( { sites: [ { ...metadata, options: {}, is_coming_soon: false } ] } );
		const services = await createPublishServices( '/tmp/source-site' );
		await expect( services.snapshot( remote ) ).rejects.toThrow( 'metadata is incomplete' );
	} );
	it( 'normalizes literal and escaped local URLs in page fingerprints', () => {
		const local = 'http://localhost:8887';
		const content =
			'<img src="' + local + '/photo.webp">{"url":"http:\\/\\/localhost:8887\\/photo.webp"}';
		const expected = content
			.split( local )
			.join( remote.url )
			.split( 'http:\\/\\/localhost:8887' )
			.join( 'https:\\/\\/example.wpcomstaging.com' );
		expect( contentFingerprint( content, local + '/', remote.url ) ).toBe(
			contentFingerprint( expected, remote.url, remote.url )
		);
	} );
	it( 'requires an anonymous access barrier for restricted sites', () => {
		expect( () =>
			assertAnonymousVisibility( visibility, 'Welcome to the shop', remote.url, 200 )
		).toThrow( 'Coming Soon' );
		expect( () =>
			assertAnonymousVisibility( { ...visibility, private: true }, 'Welcome', remote.url, 200 )
		).toThrow( 'private access' );
		expect( () =>
			assertAnonymousVisibility( visibility, 'A bright idea, coming soon', remote.url, 200 )
		).toThrow( 'Coming Soon' );
		expect( () =>
			assertAnonymousVisibility( { ...visibility, private: true }, 'Private Site', remote.url, 200 )
		).toThrow( 'private access' );
		expect( () =>
			assertAnonymousVisibility(
				visibility,
				'Localized provider barrier',
				remote.url,
				200,
				'coming-soon'
			)
		).not.toThrow();
	} );
	it( 'rejects an image-led Coming Soon page with no recognized access barrier', async () => {
		anonymousBrowser( { '/': 'Coming Soon <img src="photo.webp">' } );
		const directory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-access-test-' ) );
		folders.push( directory );
		const services = await createPublishServices( '/tmp/source-site' );
		await expect(
			services.verifyAccess(
				remote,
				{
					pages: [
						{
							slug: 'home',
							url: remote.url,
							title: 'Coming Soon',
							hash: 'abc',
							probe: 'ComingSoon',
						},
					],
					media: [ { file: 'photo.webp' } ],
				},
				visibility,
				directory
			)
		).rejects.toThrow( 'Restricted site media' );
	} );
} );
