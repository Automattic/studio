import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	PREVIEW_CONTENT_WIDTH_STORAGE_KEY,
	PREVIEW_PANEL_STORAGE_KEY,
} from '@/lib/resizable-panels';
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
		window.localStorage.setItem( PREVIEW_PANEL_STORAGE_KEY, '400' );
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
		window.localStorage.removeItem( PREVIEW_PANEL_STORAGE_KEY );
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
			expect( root ).toHaveStyle( '--preview-frame-content-width: 600px' );
		} );
		expect( screen.getByRole( 'separator', { name: 'Resize site preview' } ) ).toHaveAttribute(
			'aria-valuenow',
			'400'
		);
		expect( screen.getByLabelText( 'Site preview' ) ).toBeVisible();
	} );

	it( 'prefers the stored content width over the legacy preview width', async () => {
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
		expect( window.localStorage.getItem( PREVIEW_PANEL_STORAGE_KEY ) ).toBeNull();
	} );

	it( 'keeps the content width stable as the window grows', async () => {
		render(
			<PreviewSplitFrame previewOpen preview={ () => <aside aria-label="Site preview" /> }>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		const root = getFrameRoot();
		await waitFor( () => {
			expect( root ).toHaveStyle( '--preview-frame-content-width: 600px' );
		} );

		frameWidth = 1120;
		fireEvent( window, new Event( 'resize' ) );

		expect( root ).toHaveStyle( '--preview-frame-content-width: 600px' );

		frameWidth = 1300;
		fireEvent( window, new Event( 'resize' ) );

		expect( root ).toHaveStyle( '--preview-frame-content-width: 600px' );
	} );

	it( 'converts the legacy preview width when the preview opens, not while closed', async () => {
		const preview = () => <aside aria-label="Site preview" />;
		const { rerender } = render(
			<PreviewSplitFrame previewOpen={ false } preview={ preview }>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		const root = getFrameRoot();
		await waitFor( () => {
			expect( root ).toHaveStyle( '--preview-frame-content-width: calc(100% - 400px)' );
		} );

		frameWidth = 1120;
		fireEvent( window, new Event( 'resize' ) );

		expect( root ).toHaveStyle( '--preview-frame-content-width: calc(100% - 400px)' );
		expect( window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBeNull();
		expect( window.localStorage.getItem( PREVIEW_PANEL_STORAGE_KEY ) ).toBe( '400' );

		rerender(
			<PreviewSplitFrame previewOpen preview={ preview }>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		await waitFor( () => {
			expect( root ).toHaveStyle( '--preview-frame-content-width: 720px' );
		} );
		expect( window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBe( '720' );
		expect( window.localStorage.getItem( PREVIEW_PANEL_STORAGE_KEY ) ).toBeNull();
	} );

	it( 'keeps preview space reserved when the first mount measurement is zero', () => {
		frameWidth = 0;

		render(
			<PreviewSplitFrame previewOpen preview={ () => <aside aria-label="Site preview" /> }>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		const root = getFrameRoot();
		expect( root ).toHaveStyle( '--preview-frame-content-width: calc(100% - 400px)' );
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
				expect( getFrameRoot() ).toHaveStyle( '--preview-frame-content-width: 600px' )
			);
			return screen.getByRole( 'separator', { name: 'Resize site preview' } );
		}

		it( 'collapses the preview to its minimum width on Home', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.keyDown( handle, { key: 'Home' } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '360' );
			expect( window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBe( '640' );
			expect( window.localStorage.getItem( PREVIEW_PANEL_STORAGE_KEY ) ).toBeNull();
		} );

		it( 'expands the preview to its maximum width on End', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.keyDown( handle, { key: 'End' } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '720' );
			expect( window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBe( '280' );
			expect( window.localStorage.getItem( PREVIEW_PANEL_STORAGE_KEY ) ).toBeNull();
		} );

		it( 'steps the preview width with arrow keys, using a larger step with Shift', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.keyDown( handle, { key: 'ArrowLeft' } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '416' );
			fireEvent.keyDown( handle, { key: 'ArrowRight', shiftKey: true } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '376' );
			expect( window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBe( '624' );
			expect( window.localStorage.getItem( PREVIEW_PANEL_STORAGE_KEY ) ).toBeNull();
		} );

		it( 'persists the dragged width on mouse resize', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.mouseDown( handle, { button: 0, clientX: 500 } );
			fireEvent.mouseUp( document, { clientX: 440 } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '460' );
			expect( window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBe( '540' );
			expect( window.localStorage.getItem( PREVIEW_PANEL_STORAGE_KEY ) ).toBeNull();
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
			expect( window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBe( '600' );
			expect( window.localStorage.getItem( PREVIEW_PANEL_STORAGE_KEY ) ).toBeNull();
		} );

		it( 'ignores non-primary mouse buttons', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.mouseDown( handle, { button: 2, clientX: 500 } );
			fireEvent.mouseUp( document, { clientX: 200 } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '400' );
			expect( window.localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBe( '600' );
			expect( window.localStorage.getItem( PREVIEW_PANEL_STORAGE_KEY ) ).toBeNull();
		} );
	} );
} );
