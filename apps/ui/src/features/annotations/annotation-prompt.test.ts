import { validateStudioVisualAnnotations } from '@studio/common/ai/visual-annotations';
import { describe, expect, it } from 'vitest';
import { annotationSubmission } from './submission';
import type { PreviewAnnotation } from './store';

const note = {
	id: 'note',
	number: 1,
	selector: 'h1',
	tag: 'h1',
	classes: [],
	nearbyText: 'Hello',
	url: 'http://localhost/',
	path: '/',
	viewport: { width: 800, height: 600 },
	documentRect: { left: 0, top: 0, width: 100, height: 40 },
	comment: '',
	images: [
		{
			id: 'reference',
			kind: 'image',
			mimeType: 'image/png',
			name: 'reference.png',
			size: 1,
			dataBase64: 'eA==',
		},
	],
} as PreviewAnnotation;

describe( 'annotation image submission', () => {
	it( 'keeps image-only notes associated with their multimodal content', () => {
		const { prompt, options } = annotationSubmission( '', [], [ note ] );
		expect( prompt ).toContain( 'Attached images (in attachment order): 1' );
		expect( prompt ).not.toContain( 'attached images 1' );
		expect( prompt ).not.toContain( 'eA==' );
		expect( options.images[ 0 ].id ).toBe( 'reference' );
		expect( validateStudioVisualAnnotations( options.visualAnnotations, options.images ) ).toEqual(
			[ expect.objectContaining( { comment: '', imageIds: [ 'reference' ] } ) ]
		);
	} );

	it( 'rejects missing, repeated, or unrelated image references', () => {
		for ( const imageIds of [ [], [ 'missing' ], [ 'reference', 'reference' ] ] ) {
			expect( () =>
				validateStudioVisualAnnotations( [ { comment: '', imageIds } ], [ { id: 'reference' } ] )
			).toThrow();
		}
	} );

	it( 'still accepts legacy text-only summaries', () => {
		expect( validateStudioVisualAnnotations( [ { comment: 'Shorter' } ] )?.[ 0 ].comment ).toBe(
			'Shorter'
		);
	} );
} );
