import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

// Pin the corrected generator doctrine so a prompt edit can't silently
// reintroduce the four shipped bugs (remote fonts, CPT archive routing
// collision, archive-loop recursion, unregistered-taxonomy queries) without a
// test failing — no LLM call required.
const generators = path.join(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'..',
	'skills',
	'site-generator',
	'generators'
);
const read = ( rel: string ): string => readFileSync( path.join( generators, rel ), 'utf8' );

describe( 'skill prompt doctrine (regression guards)', () => {
	it( 'theme-json.md mandates system-font tokens, not a remote fontFace src', () => {
		const md = read( 'theme-json.md' );
		expect( md ).toMatch( /Do NOT emit `fontFace`/i );
		expect( md ).toContain( 'system-ui' );
		// The old mandate — a fonts.gstatic.com woff2 src example — is gone.
		expect( md ).not.toMatch( /gstatic\.com\/s\// );
	} );

	it( 'companion-plugin.md forbids page-colliding archive slugs and prefers meta over taxonomies', () => {
		const md = read( 'companion-plugin.md' );
		expect( md ).toMatch( /NEVER share a base with a content page/i );
		expect( md ).toMatch( /Prefer post meta over custom taxonomies/i );
	} );

	it( 'template.md carries the archive loop recursion guards', () => {
		const md = read( 'template.md' );
		expect( md ).toMatch( /NEVER place `wp:post-content` inside a `wp:post-template`/i );
		expect( md ).toContain( 'perPage:-1' );
		expect( md ).toMatch( /Filter loops by `postType` ONLY/i );
	} );

	it( 'page-content.md steers facets to post_meta and bans a custom taxQuery', () => {
		const md = read( 'page-content.md' );
		expect( md ).toMatch( /never add a `taxQuery`/i );
		expect( md ).toContain( 'post_meta' );
	} );
} );
