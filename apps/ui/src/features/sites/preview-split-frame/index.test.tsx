import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowControlsCornerContext } from '@/data/host/use-window-controls-inset';
import {
	getPreviewContentWidthStorageKey,
	PREVIEW_CONTENT_WIDTH_STORAGE_KEY,
} from '@/data/resizable-panels';
import { SidebarCollapsedContext } from '@/data/use-sidebar-collapsed';
import { PreviewSplitFrame } from './index';
import type { ComponentProps } from 'react';

const SITE_WIDTH_KEY = PREVIEW_CONTENT_WIDTH_STORAGE_KEY;

function CornerProbe( { testId }: { testId: string } ) {
	const inCorner = useContext( WindowControlsCornerContext );
	return <span data-testid={ testId } data-in-corner={ String( inCorner ) } />;
}

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
		window.localStorage.removeItem( SITE_WIDTH_KEY );
		window.localStorage.removeItem( getPreviewContentWidthStorageKey( 'one' ) );
		window.localStorage.removeItem( getPreviewContentWidthStorageKey( 'two' ) );
		window.localStorage.removeItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY );
		vi.unstubAllGlobals();
	} );

	describe( 'closing preview content', () => {
		beforeEach( () => {
			vi.useFakeTimers();
			document.documentElement.style.setProperty( '--motion-duration-layout', '240ms' );
			document.documentElement.style.setProperty( '--motion-duration-surface', '180ms' );
		} );

		afterEach( () => {
			vi.useRealTimers();
			document.documentElement.style.removeProperty( '--motion-duration-layout' );
			document.documentElement.style.removeProperty( '--motion-duration-surface' );
		} );

		function frame( site: string, open: boolean, instant = false, loading = false ) {
			return (
				<PreviewSplitFrame
					siteId="one"
					previewOpen={ open }
					instant={ instant }
					previewLoading={ loading }
					preview={ ( { collapsed } ) => (
						<aside aria-label="Site preview" data-collapsed={ collapsed }>
							{ site }
						</aside>
					) }
				>
					<span data-testid="content">Content</span>
				</PreviewSplitFrame>
			);
		}

		it( 'enables resizing after the startup fade without remounting the preview', async () => {
			const { rerender } = render( frame( 'Loading site', false, false, true ) );
			const preview = screen.getByLabelText( 'Site preview' );
			rerender( frame( 'Running site', true ) );
			expect( screen.getByRole( 'complementary', { name: 'Site preview' } ) ).toBe( preview );
			expect(
				screen.queryByRole( 'separator', { name: 'Resize site preview' } )
			).not.toBeInTheDocument();
			await act( () => vi.advanceTimersByTime( 180 ) );
			expect(
				screen.getByRole( 'separator', { name: 'Resize site preview' } )
			).toBeInTheDocument();
			expect( screen.getByRole( 'complementary', { name: 'Site preview' } ) ).toBe( preview );
		} );

		it( 'keeps the outgoing site through the exit, even when another stopped site is selected', async () => {
			const { rerender } = render( frame( 'Running site', true ) );

			rerender( frame( 'Stopped site', false ) );

			expect( screen.getByLabelText( 'Site preview' ) ).toHaveTextContent( 'Running site' );
			expect( screen.getByLabelText( 'Site preview' ) ).toHaveAttribute( 'data-collapsed', 'true' );
			expect(
				screen.queryByRole( 'complementary', { name: 'Site preview' } )
			).not.toBeInTheDocument();
			await act( () => vi.advanceTimersByTime( 120 ) );
			rerender( frame( 'Another stopped site', false ) );
			expect( screen.getByLabelText( 'Site preview' ) ).toHaveTextContent( 'Running site' );

			await act( () => vi.advanceTimersByTime( 120 ) );

			expect( screen.getByLabelText( 'Site preview' ) ).toHaveTextContent( 'Another stopped site' );
			expect( screen.getByLabelText( 'Site preview' ) ).toHaveAttribute( 'data-collapsed', 'true' );
		} );

		it( 'shows the incoming running site immediately when the exit is reversed', async () => {
			const { rerender } = render( frame( 'Running site', true ) );
			rerender( frame( 'Stopped site', false ) );
			await act( () => vi.advanceTimersByTime( 120 ) );

			rerender( frame( 'Another running site', true ) );

			expect( screen.getByRole( 'complementary', { name: 'Site preview' } ) ).toHaveTextContent(
				'Another running site'
			);
			expect( screen.getByLabelText( 'Site preview' ) ).toHaveAttribute(
				'data-collapsed',
				'false'
			);
			await act( () => vi.advanceTimersByTime( 240 ) );
			expect( screen.getByRole( 'complementary', { name: 'Site preview' } ) ).toHaveTextContent(
				'Another running site'
			);
		} );

		it( 'finishes a manual slide immediately when startup takes over the same open layout', () => {
			const { rerender } = render( frame( 'Stopped site', false ) );
			rerender( frame( 'Stopped site', true ) );
			expect(
				screen.queryByRole( 'separator', { name: 'Resize site preview' } )
			).not.toBeInTheDocument();
			rerender( frame( 'Starting site', true, true ) );
			expect(
				screen.getByRole( 'separator', { name: 'Resize site preview' } )
			).toBeInTheDocument();
		} );

		it( 'closes immediately when an instant close interrupts an opening preview', async () => {
			const { rerender } = render( frame( 'Stopped site', false ) );
			rerender( frame( 'Running site', true ) );
			await act( () => vi.advanceTimersByTime( 120 ) );

			rerender( frame( 'Stopped site', false, true ) );

			expect( screen.getByLabelText( 'Site preview' ) ).toHaveTextContent( 'Stopped site' );
			expect( screen.getByLabelText( 'Site preview' ) ).toHaveAttribute( 'data-collapsed', 'true' );
		} );
	} );

	it( 'lays out the preview immediately when mounted open', async () => {
		render(
			<PreviewSplitFrame
				siteId="one"
				previewOpen
				preview={ () => <aside aria-label="Site preview" /> }
			>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		const root = getFrameRoot();

		await waitFor( () => {
			expect( root ).toHaveStyle( '--preview-frame-content-width: 360px' );
		} );
		expect( screen.getByRole( 'separator', { name: 'Resize site preview' } ) ).toHaveAttribute(
			'aria-valuenow',
			'640'
		);
		expect( screen.getByLabelText( 'Site preview' ) ).toBeVisible();
	} );

	it( 'shares the resized width across sites and reloads without remounting the preview', () => {
		window.localStorage.setItem( getPreviewContentWidthStorageKey( 'one' ), '620' );
		const frame = ( siteId: string ) => (
			<PreviewSplitFrame
				siteId={ siteId }
				previewOpen
				preview={ () => <aside aria-label="Site preview" /> }
			>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);
		const { rerender, unmount } = render( frame( 'one' ) );
		expect( getFrameRoot() ).toHaveStyle( '--preview-frame-content-width: 360px' );
		const preview = screen.getByLabelText( 'Site preview' );
		fireEvent.keyDown( screen.getByRole( 'separator' ), { key: 'ArrowRight' } );
		expect( localStorage.getItem( SITE_WIDTH_KEY ) ).toBe( '376' );
		rerender( frame( 'two' ) );
		expect( getFrameRoot() ).toHaveStyle( '--preview-frame-content-width: 376px' );
		expect( screen.getByLabelText( 'Site preview' ) ).toBe( preview );
		fireEvent.keyDown( screen.getByRole( 'separator' ), { key: 'ArrowRight', shiftKey: true } );
		expect( localStorage.getItem( PREVIEW_CONTENT_WIDTH_STORAGE_KEY ) ).toBe( '416' );
		rerender( frame( 'one' ) );
		expect( getFrameRoot() ).toHaveStyle( '--preview-frame-content-width: 416px' );
		unmount();
		render( frame( 'two' ) );
		expect( getFrameRoot() ).toHaveStyle( '--preview-frame-content-width: 416px' );
		expect( screen.getByRole( 'separator', { name: 'Resize site preview' } ) ).toHaveAttribute(
			'aria-valuenow',
			'584'
		);
	} );

	it( 'cancels a drag when switching sites without overwriting the shared width', () => {
		localStorage.setItem( SITE_WIDTH_KEY, '500' );
		const frame = ( siteId: string ) => (
			<PreviewSplitFrame siteId={ siteId } previewOpen preview={ () => <aside /> }>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);
		const { rerender } = render( frame( 'one' ) );
		fireEvent.mouseDown( screen.getByRole( 'separator' ), { clientX: 500 } );
		rerender( frame( 'two' ) );
		fireEvent.mouseUp( document, { clientX: 620 } );
		expect( document.body ).not.toHaveStyle( { cursor: 'col-resize' } );
		expect( localStorage.getItem( SITE_WIDTH_KEY ) ).toBe( '500' );
		expect( localStorage.getItem( getPreviewContentWidthStorageKey( 'two' ) ) ).toBeNull();
		expect( getFrameRoot() ).toHaveStyle( '--preview-frame-content-width: 500px' );
	} );

	it( 'keeps the content width stable as the window grows', async () => {
		render(
			<PreviewSplitFrame
				siteId="one"
				previewOpen
				preview={ () => <aside aria-label="Site preview" /> }
			>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		const root = getFrameRoot();
		await waitFor( () => {
			expect( root ).toHaveStyle( '--preview-frame-content-width: 360px' );
		} );

		frameWidth = 1120;
		fireEvent( window, new Event( 'resize' ) );

		expect( root ).toHaveStyle( '--preview-frame-content-width: 360px' );

		frameWidth = 1300;
		fireEvent( window, new Event( 'resize' ) );

		expect( root ).toHaveStyle( '--preview-frame-content-width: 360px' );
	} );

	describe( 'window controls corner', () => {
		function renderFrame(
			sidebarCollapsed: boolean,
			props: Partial< ComponentProps< typeof PreviewSplitFrame > >
		) {
			render(
				<SidebarCollapsedContext.Provider value={ sidebarCollapsed }>
					<PreviewSplitFrame
						siteId="one"
						preview={ () => <CornerProbe testId="preview" /> }
						{ ...props }
					>
						<span data-testid="content">Content</span>
						<CornerProbe testId="chat" />
					</PreviewSplitFrame>
				</SidebarCollapsedContext.Provider>
			);
			return {
				chat: screen.getByTestId( 'chat' ).dataset.inCorner,
				preview: screen.getByTestId( 'preview' ).dataset.inCorner,
			};
		}

		it( 'puts the chat in the corner when the preview is closed', () => {
			expect( renderFrame( true, {} ) ).toEqual( { chat: 'true', preview: 'false' } );
		} );

		it( 'puts the preview in the corner when it is open', () => {
			expect( renderFrame( true, { previewOpen: true } ) ).toEqual( {
				chat: 'false',
				preview: 'true',
			} );
		} );
	} );

	it( 'keeps preview space reserved when the first mount measurement is zero', () => {
		frameWidth = 0;

		render(
			<PreviewSplitFrame
				siteId="one"
				previewOpen
				preview={ () => <aside aria-label="Site preview" /> }
			>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		const root = getFrameRoot();
		expect( root ).toHaveStyle( '--preview-frame-content-width: 360px' );
		expect( screen.getByLabelText( 'Site preview' ) ).toBeVisible();
	} );

	it( 'keeps the preview open in a narrow frame, split in proportion and not resizable', async () => {
		frameWidth = 544;

		render(
			<PreviewSplitFrame
				siteId="one"
				previewOpen
				preview={ () => <aside aria-label="Site preview" /> }
			>
				<span data-testid="content">Content</span>
			</PreviewSplitFrame>
		);

		await waitFor( () =>
			expect( getFrameRoot() ).toHaveStyle( '--preview-frame-content-width: 272px' )
		);
		expect( screen.getByLabelText( 'Site preview' ) ).toBeVisible();
		expect( screen.queryByRole( 'separator' ) ).not.toBeInTheDocument();
	} );

	describe( 'keyboard and pointer resizing', () => {
		async function renderOpenAndSettle() {
			render(
				<PreviewSplitFrame
					siteId="one"
					previewOpen
					preview={ () => <aside aria-label="Site preview" /> }
				>
					<span data-testid="content">Content</span>
				</PreviewSplitFrame>
			);
			await waitFor( () =>
				expect( getFrameRoot() ).toHaveStyle( '--preview-frame-content-width: 360px' )
			);
			return screen.getByRole( 'separator', { name: 'Resize site preview' } );
		}

		it( 'collapses the preview to its minimum width on Home', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.keyDown( handle, { key: 'Home' } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '360' );
			expect( window.localStorage.getItem( SITE_WIDTH_KEY ) ).toBe( '640' );
		} );

		it( 'expands the preview to its maximum width on End', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.keyDown( handle, { key: 'End' } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '640' );
			expect( window.localStorage.getItem( SITE_WIDTH_KEY ) ).toBe( '360' );
		} );

		it( 'steps the preview width with arrow keys, using a larger step with Shift', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.keyDown( handle, { key: 'ArrowRight', shiftKey: true } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '600' );
			fireEvent.keyDown( handle, { key: 'ArrowLeft' } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '616' );
			expect( window.localStorage.getItem( SITE_WIDTH_KEY ) ).toBe( '384' );
		} );

		it( 'persists the dragged width on mouse resize', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.mouseDown( handle, { button: 0, clientX: 500 } );
			fireEvent.mouseUp( document, { clientX: 560 } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '580' );
			expect( window.localStorage.getItem( SITE_WIDTH_KEY ) ).toBe( '420' );
		} );

		it( 'cleans up document drag state if the preview closes mid-resize', async () => {
			const preview = () => <aside aria-label="Site preview" />;
			const { rerender } = render(
				<PreviewSplitFrame siteId="one" previewOpen preview={ preview }>
					<span data-testid="content">Content</span>
				</PreviewSplitFrame>
			);
			const handle = await screen.findByRole( 'separator', { name: 'Resize site preview' } );

			fireEvent.mouseDown( handle, { button: 0, clientX: 500 } );
			expect( document.body ).toHaveStyle( { cursor: 'col-resize' } );
			expect( document.body ).toHaveStyle( { userSelect: 'none' } );

			rerender(
				<PreviewSplitFrame siteId="one" previewOpen={ false } preview={ preview }>
					<span data-testid="content">Content</span>
				</PreviewSplitFrame>
			);

			await waitFor( () => {
				expect( document.body ).toHaveStyle( { cursor: '' } );
				expect( document.body ).toHaveStyle( { userSelect: '' } );
			} );
			fireEvent.mouseUp( document, { clientX: 440 } );
			expect( window.localStorage.getItem( SITE_WIDTH_KEY ) ).toBeNull();
		} );

		it( 'ignores non-primary mouse buttons', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.mouseDown( handle, { button: 2, clientX: 500 } );
			fireEvent.mouseUp( document, { clientX: 200 } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '640' );
			expect( window.localStorage.getItem( SITE_WIDTH_KEY ) ).toBeNull();
		} );
	} );
} );
