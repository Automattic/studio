import { expect, it, vi } from 'vitest';
import { headerMenuChanges } from '@studio/agent/node/header-menu';
import { createFakeHostWithSites } from '@studio/agent/node/tests/fake-host';
import type { HostSite } from '@studio/agent/shared/host';

// The front page WordPress renders; none when WordPress cannot render it.
const page = vi.hoisted( () => ( { html: undefined as string | undefined } ) );
vi.mock( '@studio/agent/node/front-page-render', () => ( {
	readRenderedVersions: async () => ( { 'post:2': 'a' } ),
	renderFrontPage: async () => {
		if ( page.html === undefined ) {
			throw new Error( 'the render failed' );
		}
		return { html: page.html };
	},
} ) );

const site = { id: '1', name: 'Yoga', path: '/sites/yoga', url: 'http://localhost:8881' };
const host = createFakeHostWithSites( [ site ] );
const part = ( inner: string ) =>
	`<header class="wp-block-template-part"><header class="wp-block-group site-header">${ inner }</header></header><main><a href="/blog/">Blog</a><a href="/shop/">Shop</a></main>`;
const brand = '<p><a href="/">Eval Yoga Studio</a></p>';
const links =
	'<p><a href="/classes/">Classes</a></p><p><a href="http://localhost:8881/about/">About</a></p>';

// The problem raised on a call that changed what the front page renders, from
// the site as Studio first saw it to `html`.
async function raised( html: string | undefined, first = part( brand ) ) {
	page.html = first;
	const before = await headerMenuChanges.read( site.path, undefined, host );
	page.html = html;
	const after = { ...( await headerMenuChanges.read( site.path, before, host ) ), 'post:2': 'b' };
	const { reports } = await headerMenuChanges.check( site as HostSite, before, after, host );
	return reports[ 0 ]?.problem;
}

it.each( [
	{
		name: 'links to several pages with no navigation',
		html: part( brand + links + '<p><a href="/classes/">Book</a></p>' ),
		problem:
			'The header of http://localhost:8881 links to /classes/, /about/ outside a core/navigation block, so the site has no menu',
	},
	{
		name: 'the same links in core/navigation',
		html: part( brand + `<nav class="wp-block-navigation">${ links }</nav>` ),
	},
	{ name: 'one call to action', html: part( brand + '<p><a href="/classes/">Book</a></p>' ) },
	{
		name: 'links to other sites and to home sections',
		html: part(
			brand +
				'<a href="https://instagram.com/yoga">IG</a><a href="https://maps.example/studio">Map</a><a href="/#classes">Classes</a>'
		),
	},
	{
		name: 'links to several home sections with no navigation',
		html: part(
			brand +
				'<p><a href="/#features">Features</a></p><p><a href="http://localhost:8881/#about">About</a></p>'
		),
		problem:
			'The header of http://localhost:8881 links to /#features, /#about outside a core/navigation block, so the site has no menu',
	},
	{ name: 'a page with no header template part', html: `<div>${ links }</div>` },
	{ name: 'a site WordPress cannot render', html: undefined },
] )( 'on the call that renders $name', async ( { html, problem } ) => {
	const result = await raised( html );
	if ( problem ) {
		expect( result ).toContain( problem );
	} else {
		expect( result ).toBeUndefined();
	}
} );

it( 'leaves the header menu the site had as Studio first saw it', async () => {
	const html = part( brand + links );
	expect( await raised( html, html ) ).toBeUndefined();
} );
