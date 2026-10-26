import { act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { AnnotationOverlay } from './overlay';
import {
	changeAnnotation,
	clearAnnotations,
	getSiteAnnotations,
	pickAnnotation,
	setAnnotating,
} from './store';
import type { ComposerImageAttachment } from '@studio/common/ai/composer-attachments';

const SITE = 'images';

afterEach( () => {
	clearAnnotations( SITE );
	setAnnotating( SITE, false );
} );

async function openEditor( otherImages: ComposerImageAttachment[] = [] ) {
	let editing = '';
	act( () => {
		setAnnotating( SITE, true );
		if ( otherImages.length ) {
			const other = pickAnnotation( SITE, { selector: 'p' } )!;
			changeAnnotation( SITE, other, { images: otherImages } );
		}
		editing = pickAnnotation( SITE, { selector: 'h1' } )!;
	} );
	const connector = createFakeConnector();
	renderWithProviders(
		<AnnotationOverlay siteId={ SITE } anchor={ { left: 10, top: 10 } } onSend={ vi.fn() } />,
		{ connector }
	);
	await waitFor( () => expect( document.querySelector( 'input[type="file"]' ) ).not.toBeNull() );
	const upload = ( files: File[] ) =>
		fireEvent.change( document.querySelector( 'input[type="file"]' )!, { target: { files } } );
	const images = () =>
		getSiteAnnotations( SITE ).notes.find( ( note ) => note.id === editing )?.images ?? [];
	return { connector, upload, images };
}

it( 'rejects unsupported images instead of attaching them as filesystem paths', async () => {
	const { connector, upload, images } = await openEditor();
	upload( [ new File( [ '<svg />' ], 'reference.svg', { type: 'image/svg+xml' } ) ] );
	await act( async () => {} );
	expect( images() ).toHaveLength( 0 );
	expect( connector.getFilePath ).not.toHaveBeenCalled();
} );
