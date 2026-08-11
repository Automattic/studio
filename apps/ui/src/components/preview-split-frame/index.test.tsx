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
			expect( root ).toHaveStyle( '--preview-frame-content-width: 520px' );
		} );
		expect( screen.getByRole( 'separator', { name: 'Resize site preview' } ) ).toHaveAttribute(
			'aria-valuenow',
			'480'
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

	it( 'keeps the content column at its default width as the window grows', async () => {
		render(
			<PreviewSplitFrame previewOpen preview={ () => <aside aria-label="Site preview" /> }>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		const root = getFrameRoot();
		await waitFor( () => {
			expect( root ).toHaveStyle( '--preview-frame-content-width: 520px' );
		} );

		frameWidth = 1300;
		fireEvent( window, new Event( 'resize' ) );

		expect( root ).toHaveStyle( '--preview-frame-content-width: 520px' );
	} );

	it( 'restores the squeezed default content width when the window grows', async () => {
		// A narrow frame (e.g. before the post-onboarding window expansion)
		// clamps the content column below its default…
		frameWidth = 700;

		render(
			<PreviewSplitFrame previewOpen preview={ () => <aside aria-label="Site preview" /> }>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		const root = getFrameRoot();
		await waitFor( () => {
			expect( root ).toHaveStyle( '--preview-frame-content-width: 340px' );
		} );

		// …and the growth goes back to the content column, not the preview: the
		// clamped width was never frozen as the user's intent.
		frameWidth = 1000;
		fireEvent( window, new Event( 'resize' ) );

		expect( root ).toHaveStyle( '--preview-frame-content-width: 520px' );
	} );

	it( 'keeps a user-chosen content width stable as the window grows', async () => {
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

		frameWidth = 1300;
		fireEvent( window, new Event( 'resize' ) );

		expect( root ).toHaveStyle( '--preview-frame-content-width: 500px' );
	} );

	it( 'falls back to the default content width when the first mount measurement is zero', () => {
		frameWidth = 0;

		render(
			<PreviewSplitFrame previewOpen preview={ () => <aside aria-label="Site preview" /> }>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		const root = getFrameRoot();
		expect( root ).toHaveStyle( '--preview-frame-content-width: 520px' );
		expect( screen.getByLabelText( 'Site preview' ) ).toBeVisible();
	} );

	describe( 'fullscreen', () => {
		it( 'collapses the content column and hides the resize handle', async () => {
			render(
				<PreviewSplitFrame
					previewOpen
					previewFullscreen
					preview={ () => <aside aria-label="Site preview" /> }
				>
					<span data-testid="content">Content</span>
				</PreviewSplitFrame>
			);

			const root = getFrameRoot();
			expect( root ).toHaveStyle( '--preview-frame-content-width: 0px' );
			expect(
				screen.queryByRole( 'separator', { name: 'Resize site preview' } )
			).not.toBeInTheDocument();
			// The chat column stays mounted but leaves the accessibility tree.
			expect( screen.getByTestId( 'content' ).parentElement ).toHaveAttribute(
				'aria-hidden',
				'true'
			);
			expect( screen.getByLabelText( 'Site preview' ) ).toBeInTheDocument();
		} );

		it( 'restores the split when leaving fullscreen', async () => {
			const preview = () => <aside aria-label="Site preview" />;
			const { rerender } = render(
				<PreviewSplitFrame previewOpen previewFullscreen preview={ preview }>
					<span data-testid="content">Content</span>
				</PreviewSplitFrame>
			);

			const root = getFrameRoot();
			expect( root ).toHaveStyle( '--preview-frame-content-width: 0px' );

			rerender(
				<PreviewSplitFrame previewOpen preview={ preview }>
					<span data-testid="content">Content</span>
				</PreviewSplitFrame>
			);

			await waitFor( () => {
				expect( root ).toHaveStyle( '--preview-frame-content-width: 520px' );
			} );
			expect( screen.getByTestId( 'content' ).parentElement ).not.toHaveAttribute( 'aria-hidden' );
			await waitFor( () => {
				expect(
					screen.getByRole( 'separator', { name: 'Resize site preview' } )
				).toBeInTheDocument();
			} );
		} );

		it( 'keeps the content visible while the fullscreen toggle animates', () => {
			const preview = () => <aside aria-label="Site preview" />;
			const { rerender } = render(
				<PreviewSplitFrame previewOpen preview={ preview }>
					<span data-testid="content">Content</span>
				</PreviewSplitFrame>
			);

			rerender(
				<PreviewSplitFrame previewOpen previewFullscreen preview={ preview }>
					<span data-testid="content">Content</span>
				</PreviewSplitFrame>
			);

			const root = getFrameRoot();
			// Width snaps immediately; the hide waits for the slide to finish.
			expect( root ).toHaveStyle( '--preview-frame-content-width: 0px' );
			expect( screen.getByTestId( 'content' ).parentElement ).not.toHaveAttribute( 'aria-hidden' );
		} );
	} );

	describe( 'keyboard and pointer resizing', () => {
		async function renderOpenAndSettle() {
			render(
				<PreviewSplitFrame previewOpen preview={ () => <aside aria-label="Site preview" /> }>
					<span data-testid="content">Content</span>
				</PreviewSplitFrame>
			);
			await waitFor( () =>
				expect( getFrameRoot() ).toHaveStyle( '--preview-frame-content-width: 520px' )
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
			expect( handle ).toHaveAttribute( 'aria-valuenow', '496' );
			fireEvent.keyDown( handle, { key: 'ArrowRight', shiftKey: true } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '456' );
			expect( window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBe( '544' );
		} );

		it( 'persists the dragged width on mouse resize', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.mouseDown( handle, { button: 0, clientX: 500 } );
			fireEvent.mouseUp( document, { clientX: 440 } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '540' );
			expect( window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBe( '460' );
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
			expect( handle ).toHaveAttribute( 'aria-valuenow', '480' );
			expect( window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBeNull();
		} );
	} );
} );
