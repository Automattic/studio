import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_PANEL_STORAGE_KEY } from '@/lib/resizable-panels';
import { PreviewSplitFrame } from './index';

describe( 'PreviewSplitFrame', () => {
	let getBoundingClientRectSpy: ReturnType< typeof vi.spyOn >;

	beforeEach( () => {
		window.localStorage.setItem( PREVIEW_PANEL_STORAGE_KEY, '400' );
		getBoundingClientRectSpy = vi
			.spyOn( HTMLElement.prototype, 'getBoundingClientRect' )
			.mockReturnValue( {
				x: 0,
				y: 0,
				width: 1000,
				height: 700,
				top: 0,
				right: 1000,
				bottom: 700,
				left: 0,
				toJSON: () => ( {} ),
			} );
	} );

	afterEach( () => {
		getBoundingClientRectSpy.mockRestore();
		window.localStorage.removeItem( PREVIEW_PANEL_STORAGE_KEY );
	} );

	it( 'lays out the preview immediately when mounted open', async () => {
		render(
			<PreviewSplitFrame
				previewOpen
				preview={ ( { collapsed, layoutWidth } ) => (
					<aside
						aria-label="Site preview"
						data-collapsed={ collapsed ? 'true' : 'false' }
						data-layout-width={ layoutWidth }
					/>
				) }
			>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		const root = screen.getByTestId( 'content' ).parentElement?.parentElement?.parentElement;
		expect( root ).toBeTruthy();

		await waitFor( () => {
			expect( root ).toHaveStyle( '--preview-frame-content-width: 600px' );
			expect( screen.getByLabelText( 'Site preview' ) ).toHaveAttribute(
				'data-layout-width',
				'400'
			);
		} );
		expect( screen.getByLabelText( 'Site preview' ) ).toHaveAttribute( 'data-collapsed', 'false' );
	} );

	it( 'keeps preview space reserved when the first mount measurement is zero', () => {
		getBoundingClientRectSpy.mockReturnValue( {
			x: 0,
			y: 0,
			width: 0,
			height: 0,
			top: 0,
			right: 0,
			bottom: 0,
			left: 0,
			toJSON: () => ( {} ),
		} );

		render(
			<PreviewSplitFrame
				previewOpen
				preview={ ( { collapsed, layoutWidth } ) => (
					<aside
						aria-label="Site preview"
						data-collapsed={ collapsed ? 'true' : 'false' }
						data-layout-width={ layoutWidth }
					/>
				) }
			>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		const root = screen.getByTestId( 'content' ).parentElement?.parentElement?.parentElement;
		expect( root ).toHaveStyle( '--preview-frame-content-width: calc(100% - 400px)' );
		expect( screen.getByLabelText( 'Site preview' ) ).toHaveAttribute( 'data-layout-width', '400' );
		expect( screen.getByLabelText( 'Site preview' ) ).toHaveAttribute( 'data-collapsed', 'false' );
	} );

	describe( 'keyboard and pointer resizing', () => {
		// The root measures 1000px (mocked getBoundingClientRect), the preview
		// minimum is 360px, and MIN_CONTENT_WIDTH is 280px — so the preview can
		// range from 360px (Home) up to 720px (End) within a 1000px container.
		async function renderOpenAndSettle() {
			render(
				<PreviewSplitFrame previewOpen preview={ () => <aside aria-label="Site preview" /> }>
					<span data-testid="content">Content</span>
				</PreviewSplitFrame>
			);
			const root = screen.getByTestId( 'content' ).parentElement?.parentElement?.parentElement;
			await waitFor( () => expect( root ).toHaveStyle( '--preview-frame-content-width: 600px' ) );
			return screen.getByRole( 'separator', { name: 'Resize site preview' } );
		}

		it( 'collapses the preview to its minimum width on Home', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.keyDown( handle, { key: 'Home' } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '360' );
			expect( window.localStorage.getItem( PREVIEW_PANEL_STORAGE_KEY ) ).toBe( '360' );
		} );

		it( 'expands the preview to its maximum width on End', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.keyDown( handle, { key: 'End' } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '720' );
			expect( window.localStorage.getItem( PREVIEW_PANEL_STORAGE_KEY ) ).toBe( '720' );
		} );

		it( 'steps the preview width with arrow keys, using a larger step with Shift', async () => {
			const handle = await renderOpenAndSettle();
			// ArrowLeft shrinks the content column, widening the preview by one step (16px).
			fireEvent.keyDown( handle, { key: 'ArrowLeft' } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '416' );
			// Shift uses a 40px step; ArrowRight widens the content column instead.
			fireEvent.keyDown( handle, { key: 'ArrowRight', shiftKey: true } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '376' );
			expect( window.localStorage.getItem( PREVIEW_PANEL_STORAGE_KEY ) ).toBe( '376' );
		} );

		it( 'persists the dragged width on mouse resize', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.mouseDown( handle, { button: 0, clientX: 500 } );
			// Dragging left by 60px shrinks the content column and widens the preview.
			fireEvent.mouseUp( document, { clientX: 440 } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '460' );
			expect( window.localStorage.getItem( PREVIEW_PANEL_STORAGE_KEY ) ).toBe( '460' );
		} );

		it( 'ignores non-primary mouse buttons', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.mouseDown( handle, { button: 2, clientX: 500 } );
			fireEvent.mouseUp( document, { clientX: 200 } );
			// Width is unchanged from the initial stored value.
			expect( handle ).toHaveAttribute( 'aria-valuenow', '400' );
			expect( window.localStorage.getItem( PREVIEW_PANEL_STORAGE_KEY ) ).toBe( '400' );
		} );
	} );
} );
