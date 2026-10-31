import { mkdirSync, mkdtempSync, readFileSync } from 'fs';
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
		expect( await call( '', '2026-10-23 00:00:00' ) ).toEqual( [
			{
				key: 'content 11',
				post: '11',
				problem: `Shop page 11 is now empty: this call replaced its ${ home.length } characters of content with none. Studio kept what it held in ${ previous }.`,
			},
		] );
		expect( readFileSync( previous, 'utf8' ) ).toBe( home );
		// Its content back, the problem closes.
		expect( await call( home, '2026-10-24 00:00:00' ) ).toEqual( [
			{ key: 'content 11', post: '11', problem: undefined },
		] );
	} finally {
		vi.unstubAllEnvs();
	}
} );
