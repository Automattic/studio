import { afterEach, expect, it, vi } from 'vitest';
import { headerMenu } from '@studio/agent/node/header-menu';
import { createFakeHostWithSites } from '@studio/agent/node/tests/fake-host';

const host = createFakeHostWithSites( [ { path: '/sites/yoga', url: 'http://localhost:8881' } ] );

afterEach( () => vi.unstubAllGlobals() );

const OTHER = 'http://localhost:8881/?p=2147483647';
const part = ( inner: string ) =>
	`<header class="wp-block-template-part"><header class="wp-block-group site-header">${ inner }</header></header><main><a href="/blog/">Blog</a><a href="/shop/">Shop</a></main>`;
const brand = '<p><a href="/">Eval Yoga Studio</a></p>';
const links =
	'<p><a href="/classes/">Classes</a></p><p><a href="http://localhost:8881/about/">About</a></p>';

it.each( [
	{
		name: 'links to several pages with no navigation',
		html: part( brand + links + '<p><a href="/classes/">Book</a></p>' ),
		problem: 'The header of http://localhost:8881 links to /classes/, /about/ with no navigation',
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
		problem: 'The header of http://localhost:8881 links to /#features, /#about with no navigation',
	},
	{ name: 'a page with no header template part', html: `<div>${ links }</div>` },
	{ name: 'a site whose server is not running', html: undefined },
] )( '$name', async ( { html, problem } ) => {
	vi.stubGlobal(
		'fetch',
		vi.fn( async ( url: string ) => {
			if ( url !== OTHER ) {
				throw new Error( `unexpected ${ url }` );
			}
			if ( html === undefined ) {
				throw new TypeError( 'fetch failed' );
			}
			return new Response( html );
		} )
	);
	const result = await headerMenu( host, '/sites/yoga' );
	if ( problem ) {
		expect( result ).toContain( problem );
	} else {
		expect( result ).toBeUndefined();
	}
} );

it( 'checks only Studio sites', async () => {
	vi.stubGlobal( 'fetch', vi.fn() );
	expect( await headerMenu( host, '/elsewhere' ) ).toBeUndefined();
} );
