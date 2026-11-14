import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeHostServices } from '@studio/agent/node/node-host';
import { composeImagePrompt, fitToTokens } from '@studio/agent/shared/image-generation';
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

describe( 'fitToTokens', () => {
	it( 'returns short text unchanged', () => {
		expect( fitToTokens( 'short prompt', 480 ) ).toBe( 'short prompt' );
	} );
} );

const hostPath = nodeHostServices().path;

describe( 'resolveImageFilePath', () => {
	it( 'accepts .png paths inside the sites root', () => {
		const target = path.join( SITES_ROOT, 'my-site', 'wp-content', 'a.png' );
		expect( resolveImageFilePath( hostPath, SITES_ROOT, target ) ).toBe( target );
	} );

	it( 'rejects paths escaping the sites root', () => {
		expect( () =>
			resolveImageFilePath( hostPath, SITES_ROOT, path.join( SITES_ROOT, '..', 'escape.png' ) )
		).toThrow( /inside the Studio sites directory/ );
	} );

	it( 'rejects non-PNG extensions', () => {
		expect( () =>
			resolveImageFilePath( hostPath, SITES_ROOT, path.join( SITES_ROOT, 'a.jpg' ) )
		).toThrow( /end in .png/ );
	} );
} );
