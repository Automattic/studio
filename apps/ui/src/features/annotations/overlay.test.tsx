import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getVisibleToasts } from '@/data/app-messages';
import { TooltipProvider } from '@/lib/ui';
import { AnnotationOverlay } from './overlay';
import {
	changeAnnotation,
	getSiteAnnotations,
	pickAnnotation,
	setAnnotating,
	stageAnnotations,
} from './store';
import type { ComposerImageAttachment } from '@studio/common/ai/composer-attachments';

vi.mock( '@/data/core', () => ( {
	useConnector: () => ( {
		getUserPreferences: vi.fn().mockResolvedValue( {} ),
		setUserPreferences: vi.fn().mockResolvedValue( undefined ),
		getFilePath: vi.fn(),
	} ),
} ) );

const image = ( id: string ): ComposerImageAttachment => ( {
	id,
	kind: 'image',
	name: `${ id }.png`,
	mimeType: 'image/png',
	size: 1,
	dataBase64: 'eA==',
} );

function renderOverlay( siteId: string ) {
	render(
		<QueryClientProvider client={ new QueryClient() }>
			<TooltipProvider delay={ 0 }>
				<AnnotationOverlay siteId={ siteId } anchor={ { left: 10, top: 10 } } onSend={ vi.fn() } />
			</TooltipProvider>
		</QueryClientProvider>
	);
}

describe( 'AnnotationOverlay', () => {
	beforeEach( () => {
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe() {}
				disconnect() {}
			}
		);
	} );

	it( 'leaves annotation mode on Cancel, deleting the notes once confirmed', async () => {
		setAnnotating( 'cancel-site', true );
		renderOverlay( 'cancel-site' );

		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect( getSiteAnnotations( 'cancel-site' ).active ).toBe( false );

		act( () => {
			setAnnotating( 'cancel-site', true );
			changeAnnotation( 'cancel-site', pickAnnotation( 'cancel-site', { selector: 'h1' } )!, {
				comment: 'Bigger',
			} );
			stageAnnotations( 'cancel-site' );
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Delete annotations' } ) );

		expect( getSiteAnnotations( 'cancel-site' ) ).toMatchObject( { active: false, notes: [] } );
	} );

	it( 'counts the other notes’ images against the message’s image limit', async () => {
		setAnnotating( 'images-site', true );
		const other = pickAnnotation( 'images-site', { selector: 'p' } )!;
		changeAnnotation( 'images-site', other, { images: [ 'a', 'b', 'c' ].map( image ) } );
		const editing = pickAnnotation( 'images-site', { selector: 'h1' } )!;
		renderOverlay( 'images-site' );

		fireEvent.change(
			screen.getByRole( 'group', { name: 'Annotation' } ).querySelector( 'input[type="file"]' )!,
			{
				target: {
					files: [
						new File( [ 'x' ], 'four.png', { type: 'image/png' } ),
						new File( [ 'x' ], 'five.png', { type: 'image/png' } ),
					],
				},
			}
		);

		await waitFor( () =>
			expect(
				getSiteAnnotations( 'images-site' )
					.notes.find( ( note ) => note.id === editing )
					?.images.map( ( item ) => item.name )
			).toEqual( [ 'four.png' ] )
		);
		expect( getVisibleToasts().map( ( toast ) => toast.title ) ).toContain(
			'You can attach up to 4 images.'
		);
	} );
} );
