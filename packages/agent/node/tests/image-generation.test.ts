import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeHostServices } from '@studio/agent/node/node-host';
import {
	composeImagePrompt,
	fitToTokens,
	withoutName,
} from '@studio/agent/shared/image-generation';
import { resolveImageFilePath } from '@studio/agent/shared/tools/generate-images';

const SITES_ROOT = path.resolve( '/studio-sites' );

describe( 'composeImagePrompt', () => {
	it( 'leads with the subject and frames context as non-literal guidance', () => {
		const prompt = composeImagePrompt(
			{
				subject: 'A rustic sourdough loaf on a floured board',
				style: 'photorealistic',
				pageContext: 'menu item thumbnail',
			},
			{ siteContext: 'A neighborhood bakery.', imageGrade: 'warm natural window light' }
		);
		expect(
			prompt.startsWith( 'A rustic sourdough loaf on a floured board. Style: photorealistic' )
		).toBe( true );
		expect( prompt ).toContain( 'Art direction for all site imagery: warm natural window light.' );
		expect( prompt ).toContain( 'Composition: menu item thumbnail. A neighborhood bakery.' );
		expect( prompt ).toContain( 'never depicted literally' );
	} );

	it( 'adds the lettering clause only when the subject names a text carrier', () => {
		const clean = composeImagePrompt( { subject: 'A misty mountain range at dawn' } );
		expect( clean ).not.toContain( 'unmarked' );

		const carrier = composeImagePrompt( { subject: 'A bakery storefront at dusk' } );
		expect( carrier ).toContain( 'its face is unmarked' );
	} );

	it( 'caps prompt length by shedding trailing context, keeping the subject', () => {
		const longContext = Array( 800 ).fill( 'context' ).join( ' ' );
		const prompt = composeImagePrompt(
			{ subject: 'A red canoe on a still lake' },
			{ siteContext: longContext }
		);
		expect( prompt.startsWith( 'A red canoe on a still lake' ) ).toBe( true );
		expect( prompt.length ).toBeLessThan( longContext.length );
	} );
} );

describe( 'withoutName', () => {
	it.each( [
		{ text: 'Corner Crumb, a neighborhood bakery.', expected: 'a neighborhood bakery.' },
		{
			text: 'A bakery called corner crumb selling sourdough.',
			expected: 'A bakery called selling sourdough.',
		},
		{ text: "Loaves on Corner Crumb's counter.", expected: 'Loaves on counter.' },
		{ text: 'Loaves on Corner Crumb’s counter, at dawn.', expected: 'Loaves on counter, at dawn.' },
		{ text: 'A bakery, Corner Crumb, at dawn.', expected: 'A bakery, at dawn.' },
		{ text: 'The Corner Crumbs team.', expected: 'The Corner Crumbs team.' },
		{ text: 'A bakery at dawn.', expected: 'A bakery at dawn.' },
		{ text: 'Bread from Corner Crumb.', expected: 'Bread from.' },
		{ text: 'A Scorner Crumb sign.', expected: 'A Scorner Crumb sign.' },
	] )( '$text', ( { text, expected } ) => {
		expect( withoutName( text, 'Corner Crumb' ) ).toBe( expected );
	} );

	it( 'takes a name with regex characters as written', () => {
		expect( withoutName( 'Coffee at Joe (+1) today.', 'Joe (+1)' ) ).toBe( 'Coffee at today.' );
		expect( withoutName( 'Coffee at Joe today.', 'Joe (+1)' ) ).toBe( 'Coffee at Joe today.' );
	} );

	it( 'leaves the text when there is no name', () => {
		expect( withoutName( 'A bakery at dawn.', '  ' ) ).toBe( 'A bakery at dawn.' );
	} );
} );

it( 'composes a prompt without the site name in the subject, composition or site context', () => {
	const prompt = composeImagePrompt(
		{ subject: 'The Corner Crumb counter at dawn', pageContext: 'Corner Crumb hero with open sky' },
		{ siteContext: 'Corner Crumb is a neighborhood bakery.', siteName: 'Corner Crumb' }
	);
	expect( prompt ).not.toMatch( /corner crumb/i );
	expect( prompt ).toContain( 'The counter at dawn' );
	expect( prompt ).toContain( 'is a neighborhood bakery.' );
} );

describe( 'fitToTokens', () => {
	it( 'returns short text unchanged', () => {
		expect( fitToTokens( 'short prompt', 480 ) ).toBe( 'short prompt' );
	} );
} );

const hostPath = nodeHostServices().path;

describe( 'resolveImageFilePath', () => {
	// eval9 picky 1: `spoke-chain/wp-content/uploads/hero.jpg` was refused.
	it( 'accepts paths inside the sites root, a relative one from it as Write takes it', () => {
		const target = path.join( SITES_ROOT, 'my-site', 'wp-content', 'a.png' );
		expect( resolveImageFilePath( hostPath, SITES_ROOT, [], target ) ).toBe( target );
		expect( resolveImageFilePath( hostPath, SITES_ROOT, [], 'my-site/wp-content/a.png' ) ).toBe(
			target
		);
	} );

	it( 'rejects paths escaping the sites root', () => {
		expect( () =>
			resolveImageFilePath( hostPath, SITES_ROOT, [], path.join( SITES_ROOT, '..', 'escape.png' ) )
		).toThrow( /inside the Studio sites directory/ );
	} );
} );
