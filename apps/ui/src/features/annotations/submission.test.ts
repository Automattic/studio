import { MAX_VISUAL_ANNOTATIONS } from '@studio/common/ai/visual-annotations';
import { describe, expect, it } from 'vitest';
import { annotationSubmission } from './submission';
import type { PreviewAnnotation } from './store';
import type { ComposerImageAttachment } from '@studio/common/ai/composer-attachments';

const image = ( id: string ): ComposerImageAttachment => ( {
	id,
	kind: 'image',
	name: `${ id }.png`,
	mimeType: 'image/png',
	size: 1,
	dataBase64: 'eA==',
} );

const note = ( overrides: Partial< PreviewAnnotation > ): PreviewAnnotation => ( {
	id: 'n1',
	number: 1,
	comment: 'Make this bigger',
	images: [],
	tag: 'h1',
	path: '/',
	...overrides,
} );

describe( 'annotationSubmission', () => {
	it( 'puts the typed message first and numbers each note’s images in send order', () => {
		const { prompt, options } = annotationSubmission(
			'Also check spacing',
			[ image( 'own' ) ],
			[
				note( { images: [ image( 'first' ) ] } ),
				note( { id: 'n2', comment: '', images: [ image( 'second' ), image( 'third' ) ] } ),
			]
		);

		expect( prompt ).toMatch( /^Also check spacing\n\nThe user submitted 2 visual annotations/ );
		expect( prompt ).toContain( '- Attached images (in attachment order): 2\n' );
		expect( prompt ).toContain( '- Attached images (in attachment order): 3, 4\n' );
		expect( options.images.map( ( item ) => item.id ) ).toEqual( [
			'own',
			'first',
			'second',
			'third',
		] );
		expect( options.visualAnnotations.map( ( item ) => item.imageIds ) ).toEqual( [
			[ 'own' ],
			[ 'first' ],
			[ 'second', 'third' ],
		] );
	} );

	it( 'reads as the note count when there is no message, and points design notes at DESIGN.md', () => {
		const { prompt, options } = annotationSubmission(
			'',
			[],
			[ note( { tag: undefined, designToken: 'colors.primary', path: 'DESIGN.md' } ) ]
		);

		expect( options.displayMessage ).toBe( '1 annotation submitted' );
		expect( options.visualAnnotations ).toEqual( [
			expect.objectContaining( { comment: 'Make this bigger', elementLabel: 'colors.primary' } ),
		] );
		expect( prompt ).toContain(
			"Annotations from the Design system page are about the site's DESIGN.md"
		);
	} );

	it( 'refuses more images than one message carries', () => {
		expect( () =>
			annotationSubmission(
				'',
				[],
				[ note( { images: [ 'a', 'b', 'c', 'd', 'e' ].map( image ) } ) ]
			)
		).toThrow( 'You can attach up to 4 images.' );
	} );

	it( 'names the limit when the typed message pushes the notes past it', () => {
		const notes = Array.from( { length: MAX_VISUAL_ANNOTATIONS }, ( _, index ) =>
			note( { id: `n${ index }`, number: index + 1 } )
		);

		expect( () => annotationSubmission( '', [], notes ) ).not.toThrow();
		expect( () => annotationSubmission( 'And this', [], notes ) ).toThrow(
			'You can send up to 100 annotations at once.'
		);
	} );
} );
