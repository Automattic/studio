import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { expect, it, vi } from 'vitest';
import { postCopies } from '@studio/agent/node/post-copies';
import { createFakeHost, fakeSite } from '@studio/agent/node/tests/fake-host';
import { createSite } from './fixtures/wordpress-site';
import type { HostSite } from '@studio/agent/node/host';

// As run eval5 picky 2: a perl edit that failed printed nothing, and
// `wp post update 11 --post_content="$(cat …)"` saved that to the front page.
it( 'says when a call empties a post, and keeps what its copy held', async () => {
	vi.stubEnv( 'DEV_CONFIG_DIR', mkdtempSync( path.join( os.tmpdir(), 'config-' ) ) );
	const host = createFakeHost();
	const wp = createSite( 'wp_' );
	const site = { ...fakeSite, id: 'site-id', name: 'Shop', path: wp.root } as HostSite;
	vi.mocked( host.sites.findByFolder ).mockResolvedValue( site );
	const workspace = path.join( process.env.DEV_CONFIG_DIR!, 'workspace/site-id' );
	mkdirSync( workspace, { recursive: true } );
	const home = '<!-- wp:paragraph --><p>Keep your ride rolling.</p><!-- /wp:paragraph -->';
	wp.save( 11, 'page', 'home', home, 1, 'publish', 'Home' );
	try {
		const call = async ( content: string, modified: string ) => {
			const before = await postCopies.read( wp.root, undefined, host );
			wp.edit( 11, content, modified );
			const after = await postCopies.read( wp.root, before, host );
			return ( await postCopies.check( site, before, after, host ) ).reports;
		};
		const previous = path.join( workspace, 'page/11.previous.html' );
		const where = `Shop page 11's content is in ${ path.join(
			workspace,
			'page/11.html'
		) }; Studio saves an edit there to the post.`;
		expect( await call( '', '2026-10-23 00:00:00' ) ).toEqual( [
			{
				key: 'content 11',
				post: '11',
				summary: where,
				problem: `Shop page 11 is now empty: this call replaced its ${ home.length } characters of content with none. Studio kept what it held in ${ previous }.`,
			},
		] );
		expect( readFileSync( previous, 'utf8' ) ).toBe( home );
		// Its content back, the problem closes.
		expect( await call( home, '2026-10-24 00:00:00' ) ).toEqual( [
			{ key: 'content 11', post: '11', summary: where, problem: undefined },
		] );
	} finally {
		vi.unstubAllEnvs();
	}
} );

// eval5/6: the model created and updated pages with `studio wp post` from
// files of its own, unaware a page it just made has a copy it could edit.
it( 'names the copy of a post a call creates, and not of one saved from its copy', async () => {
	vi.stubEnv( 'DEV_CONFIG_DIR', mkdtempSync( path.join( os.tmpdir(), 'config-' ) ) );
	const host = createFakeHost();
	const wp = createSite( 'wp_' );
	const site = { ...fakeSite, id: 'site-id', name: 'Shop', path: wp.root } as HostSite;
	vi.mocked( host.sites.findByFolder ).mockResolvedValue( site );
	mkdirSync( path.join( process.env.DEV_CONFIG_DIR!, 'workspace/site-id' ), { recursive: true } );
	wp.save( 2, 'page', 'sample', '<p>Sample</p>', 1, 'publish', 'Sample' );
	const copy = path.join( process.env.DEV_CONFIG_DIR!, 'workspace/site-id/page/12.html' );
	try {
		const call = async ( change: () => void ) => {
			const before = await postCopies.read( wp.root, undefined, host );
			change();
			const after = await postCopies.read( wp.root, before, host );
			return ( await postCopies.check( site, before, after, host ) ).reports;
		};
		expect(
			await call( () => wp.save( 12, 'page', 'home', '<p>Home</p>', 1, 'publish', 'Home' ) )
		).toEqual( [
			{
				key: 'content 12',
				post: '12',
				summary: `Shop page 12's content is in ${ copy }; Studio saves an edit there to the post.`,
				problem: undefined,
			},
		] );
		const reports = await call( () => writeFileSync( copy, '<p>Home, edited</p>' ) );
		expect( reports.map( ( report ) => report.summary ) ).not.toContainEqual(
			expect.stringContaining( 'content is in' )
		);
	} finally {
		vi.unstubAllEnvs();
	}
} );

// eval8 picky: pages made by writing a file, then `studio wp post create` on
// it, then `post update` from more files, each a request of its own.
it( 'publishes a new file named for a slug as a page, and makes it its copy', async () => {
	vi.stubEnv( 'DEV_CONFIG_DIR', mkdtempSync( path.join( os.tmpdir(), 'config-' ) ) );
	const host = createFakeHost();
	const wp = createSite( 'wp_' );
	const site = { ...fakeSite, id: 'site-id', name: 'Shop', path: wp.root } as HostSite;
	vi.mocked( host.sites.findByFolder ).mockResolvedValue( site );
	const workspace = path.join( process.env.DEV_CONFIG_DIR!, 'workspace/site-id' );
	mkdirSync( path.join( workspace, 'page' ), { recursive: true } );
	wp.save( 2, 'page', 'sample', '<p>Sample</p>', 1, 'publish', 'Sample' );
	// wp_insert_post(), as WordPress runs it: the data Studio gives it, saved.
	const inserted: unknown[] = [];
	vi.mocked( host.sites.wpCli ).mockImplementation( async ( _site, args ) => {
		const given = args[ 1 ].match( /base64_decode\( '([^']+)'/ )?.[ 1 ];
		if ( ! given ) {
			return { exitCode: 0, stdout: '', stderr: '' };
		}
		const data = JSON.parse( Buffer.from( given, 'base64' ).toString() );
		inserted.push( data );
		wp.save(
			15,
			data.type,
			data.slug,
			readFileSync( data.file, 'utf8' ),
			1,
			'publish',
			data.title
		);
		return {
			exitCode: 0,
			stdout: '{"id":15,"link":"http://localhost:8881/about-us/"}',
			stderr: '',
		};
	} );
	try {
		const call = async ( change: () => void ) => {
			const before = await postCopies.read( wp.root, undefined, host );
			change();
			const after = await postCopies.read( wp.root, before, host );
			return postCopies.check( site, before, after, host );
		};
		const file = path.join( workspace, 'page/about-us.html' );
		const copy = path.join( workspace, 'page/15.html' );
		const { reports, next } = await call( () => writeFileSync( file, '<p>About</p>' ) );
		expect( inserted ).toEqual( [ { type: 'page', slug: 'about-us', title: 'About Us', file } ] );
		expect( reports ).toEqual( [
			{
				key: 'new page/about-us.html',
				post: '15',
				summary: `Studio created page 15 "About Us" (/about-us/) from ${ file }; its content is now in ${ copy }.`,
			},
		] );
		expect( readFileSync( copy, 'utf8' ) ).toBe( '<p>About</p>' );
		expect( existsSync( file ) ).toBe( false );
		expect( Object.keys( next! ) ).toEqual( [ '2', '15' ] );
		// Its copy now saves to it as any other's does, and makes no second page.
		await call( () => writeFileSync( copy, '<p>About us</p>' ) );
		expect( inserted ).toHaveLength( 1 );
	} finally {
		vi.unstubAllEnvs();
	}
} );
