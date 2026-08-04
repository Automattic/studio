import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_CONTENT_WIDTH_STORAGE_KEY } from '@/lib/resizable-panels';
import { PreviewSplitFrame } from './index';

function getFrameRoot(): HTMLElement {
	const root = screen.getByTestId( 'content' ).parentElement?.parentElement;
	if ( ! root ) {
		throw new Error( 'PreviewSplitFrame root not found' );
	}
	return root;
}

describe( 'PreviewSplitFrame', () => {
	let getBoundingClientRectSpy: ReturnType< typeof vi.spyOn >;
	let frameWidth: number;

	beforeEach( () => {
		frameWidth = 1000;
		vi.stubGlobal( 'ResizeObserver', undefined );
		getBoundingClientRectSpy = vi
			.spyOn( HTMLElement.prototype, 'getBoundingClientRect' )
			.mockImplementation( () => ( {
				x: 0,
				y: 0,
				width: frameWidth,
				height: 700,
				top: 0,
				right: frameWidth,
				bottom: 700,
				left: 0,
				toJSON: () => ( {} ),
			} ) );
	} );

	afterEach( () => {
		getBoundingClientRectSpy.mockRestore();
		window.localStorage.removeItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY );
		vi.unstubAllGlobals();
	} );

	it( 'lays out the preview immediately when mounted open', async () => {
		render(
			<PreviewSplitFrame previewOpen preview={ () => <aside aria-label="Site preview" /> }>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		const root = getFrameRoot();

		await waitFor( () => {
			expect( root ).toHaveStyle( '--preview-frame-content-width: 480px' );
		} );
		expect( screen.getByRole( 'separator', { name: 'Resize site preview' } ) ).toHaveAttribute(
			'aria-valuenow',
			'520'
		);
		expect( screen.getByLabelText( 'Site preview' ) ).toBeVisible();
	} );

	it( 'uses the stored content width when available', async () => {
		window.localStorage.setItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY, '500' );

		render(
			<PreviewSplitFrame previewOpen preview={ () => <aside aria-label="Site preview" /> }>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		const root = getFrameRoot();
		await waitFor( () => {
			expect( root ).toHaveStyle( '--preview-frame-content-width: 500px' );
		} );
		expect( screen.getByRole( 'separator', { name: 'Resize site preview' } ) ).toHaveAttribute(
			'aria-valuenow',
			'500'
		);
	} );

	it( 'keeps the content width stable as the window grows', async () => {
		render(
			<PreviewSplitFrame previewOpen preview={ () => <aside aria-label="Site preview" /> }>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		const root = getFrameRoot();
		await waitFor( () => {
			expect( root ).toHaveStyle( '--preview-frame-content-width: 480px' );
		} );

		frameWidth = 1120;
		fireEvent( window, new Event( 'resize' ) );

		expect( root ).toHaveStyle( '--preview-frame-content-width: 480px' );

		frameWidth = 1300;
		fireEvent( window, new Event( 'resize' ) );

		expect( root ).toHaveStyle( '--preview-frame-content-width: 480px' );
	} );

	it( 'gives the whole frame to the preview in fullscreen', async () => {
		const preview = () => <aside aria-label="Site preview" />;
		const { rerender } = render(
			<PreviewSplitFrame previewOpen preview={ preview }>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);
		const root = getFrameRoot();
		await waitFor( () => expect( root ).toHaveStyle( '--preview-frame-content-width: 480px' ) );

		rerender(
			<PreviewSplitFrame previewOpen previewFullscreen preview={ preview }>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		expect( root ).toHaveStyle( '--preview-frame-content-width: 0px' );
		// Nothing left to drag once the content column is gone.
		await waitFor( () =>
			expect(
				screen.queryByRole( 'separator', { name: 'Resize site preview' } )
			).not.toBeInTheDocument()
		);
		// The chat stays mounted but out of reach until the slide finishes.
		await waitFor( () =>
			expect( screen.getByTestId( 'content' ).parentElement ).toHaveAttribute(
				'aria-hidden',
				'true'
			)
		);

		// Leaving fullscreen restores the split the user had before.
		rerender(
			<PreviewSplitFrame previewOpen preview={ preview }>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);
		expect( root ).toHaveStyle( '--preview-frame-content-width: 480px' );
	} );

	it( 'keeps preview space reserved when the first mount measurement is zero', () => {
		frameWidth = 0;

		render(
			<PreviewSplitFrame previewOpen preview={ () => <aside aria-label="Site preview" /> }>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		const root = getFrameRoot();
		expect( root ).toHaveStyle( '--preview-frame-content-width: calc(100% - 520px)' );
		expect( screen.getByLabelText( 'Site preview' ) ).toBeVisible();
	} );

	describe( 'keyboard and pointer resizing', () => {
		async function renderOpenAndSettle() {
			render(
				<PreviewSplitFrame previewOpen preview={ () => <aside aria-label="Site preview" /> }>
					<span data-testid="content">Content</span>
				</PreviewSplitFrame>
			);
			await waitFor( () =>
				expect( getFrameRoot() ).toHaveStyle( '--preview-frame-content-width: 480px' )
			);
			return screen.getByRole( 'separator', { name: 'Resize site preview' } );
		}

		it( 'collapses the preview to its minimum width on Home', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.keyDown( handle, { key: 'Home' } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '360' );
			expect( window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBe( '640' );
		} );

		it( 'expands the preview to its maximum width on End', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.keyDown( handle, { key: 'End' } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '720' );
			expect( window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBe( '280' );
		} );

		it( 'steps the preview width with arrow keys, using a larger step with Shift', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.keyDown( handle, { key: 'ArrowLeft' } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '536' );
			fireEvent.keyDown( handle, { key: 'ArrowRight', shiftKey: true } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '496' );
			expect( window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBe( '504' );
		} );

		it( 'persists the dragged width on mouse resize', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.mouseDown( handle, { button: 0, clientX: 500 } );
			fireEvent.mouseUp( document, { clientX: 440 } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '580' );
			expect( window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBe( '420' );
		} );

		it( 'cleans up document drag state if the preview closes mid-resize', async () => {
			const preview = () => <aside aria-label="Site preview" />;
			const { rerender } = render(
				<PreviewSplitFrame previewOpen preview={ preview }>
					<span data-testid="content">Content</span>
				</PreviewSplitFrame>
			);
			const handle = await screen.findByRole( 'separator', { name: 'Resize site preview' } );

			fireEvent.mouseDown( handle, { button: 0, clientX: 500 } );
			expect( document.body ).toHaveStyle( { cursor: 'col-resize' } );
			expect( document.body ).toHaveStyle( { userSelect: 'none' } );

			rerender(
				<PreviewSplitFrame previewOpen={ false } preview={ preview }>
					<span data-testid="content">Content</span>
				</PreviewSplitFrame>
			);

			await waitFor( () => {
				expect( document.body ).toHaveStyle( { cursor: '' } );
				expect( document.body ).toHaveStyle( { userSelect: '' } );
			} );
			fireEvent.mouseUp( document, { clientX: 440 } );
			expect( window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBeNull();
		} );

		it( 'ignores non-primary mouse buttons', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.mouseDown( handle, { button: 2, clientX: 500 } );
			fireEvent.mouseUp( document, { clientX: 200 } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '520' );
			expect( window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBeNull();
		} );
	} );
} );
