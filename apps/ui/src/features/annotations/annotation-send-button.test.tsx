import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { AnnotationOverlay } from './overlay';
import {
	changeAnnotation,
	clearAnnotations,
	pickAnnotation,
	setAnnotating,
	stageAnnotations,
} from './store';

const SITE = 'send-button';

afterEach( () => {
	clearAnnotations( SITE );
	setAnnotating( SITE, false );
} );

async function renderWithNotes( count: number, staged: boolean ) {
	act( () => {
		setAnnotating( SITE, true );
		for ( let index = 0; index < count; index++ ) {
			const id = pickAnnotation( SITE, { selector: `h${ index }` } )!;
			changeAnnotation( SITE, id, { comment: `Note ${ index }` } );
		}
		if ( staged ) {
			stageAnnotations( SITE );
		}
	} );
	renderWithProviders( <AnnotationOverlay siteId={ SITE } anchor={ null } onSend={ vi.fn() } /> );
	await waitFor( () =>
		expect( document.querySelector( '[data-annotation-overlay]' ) ).not.toBeNull()
	);
}

it( 'keeps the labeled floating action and its count', async () => {
	await renderWithNotes( 3, true );
	expect( screen.getByRole( 'button', { name: 'Send 3 annotations' } ) ).toHaveTextContent(
		'Send3'
	);
} );

it( 'shows no count for an unstaged draft', async () => {
	await renderWithNotes( 1, false );
	expect( screen.getByRole( 'button', { name: 'Send 1 annotation' } ) ).toHaveTextContent(
		/^Send$/
	);
} );
