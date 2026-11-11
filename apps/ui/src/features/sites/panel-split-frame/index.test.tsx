import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowControlsCornerContext } from '@/data/host/use-window-controls-inset';
import { PANEL_CONTENT_WIDTH_STORAGE_KEY } from '@/data/resizable-panels';
import { SidebarCollapsedContext } from '@/data/use-sidebar-collapsed';
import { PanelSplitFrame } from './index';
import type { ComponentProps } from 'react';

const SITE_WIDTH_KEY = PANEL_CONTENT_WIDTH_STORAGE_KEY;

function CornerProbe( { testId }: { testId: string } ) {
	const inCorner = useContext( WindowControlsCornerContext );
	return <span data-testid={ testId } data-in-corner={ String( inCorner ) } />;
}

function getFrameRoot(): HTMLElement {
	const root = screen.getByTestId( 'content' ).parentElement?.parentElement;
	if ( ! root ) {
		throw new Error( 'PanelSplitFrame root not found' );
	}
	return root;
}

describe( 'PanelSplitFrame', () => {
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
		window.localStorage.removeItem( `${ PANEL_CONTENT_WIDTH_STORAGE_KEY }:one` );
		window.localStorage.removeItem( `${ PANEL_CONTENT_WIDTH_STORAGE_KEY }:two` );
		window.localStorage.removeItem( PANEL_CONTENT_WIDTH_STORAGE_KEY );
		vi.unstubAllGlobals();
	} );

	describe( 'closing panel content', () => {
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

		function frame( site: string, open: boolean, instant = false ) {
			return (
				<PanelSplitFrame
					siteId="one"
					panelOpen={ open }
					instant={ instant }
					panel={ ( { collapsed } ) => (
						<aside aria-label="Panel" data-collapsed={ collapsed }>
							{ site }
						</aside>
					) }
				>
					<span data-testid="content">Content</span>
				</PanelSplitFrame>
			);
		}

		it( 'keeps the resize handle mounted while the panel closes and reopens', async () => {
			const { rerender } = render( frame( 'Ready', true ) );
			const handle = screen.getByRole( 'separator', { name: 'Resize panel' } );
			rerender( frame( 'Ready', false ) );
			expect( handle ).toBeInTheDocument();
			expect( handle.closest( '[inert]' ) ).not.toBeNull();
			await act( () => vi.advanceTimersByTime( 100 ) );
			rerender( frame( 'Ready', true ) );
			expect( handle ).toBeInTheDocument();
			await act( () => vi.advanceTimersByTime( 240 ) );
			expect( screen.getByRole( 'separator', { name: 'Resize panel' } ) ).toBe( handle );
			expect( handle.closest( '[inert]' ) ).toBeNull();
		} );

		it( 'keeps the slide running when loading changes midway through it', async () => {
			const { rerender } = render( frame( 'Stopped', false ) );
			rerender( frame( 'Starting', true ) );
			await act( () => vi.advanceTimersByTime( 120 ) );
			rerender( frame( 'Ready', true ) );
			expect( getFrameRoot() ).toHaveAttribute( 'data-layout-moving', 'true' );
			expect( screen.queryByRole( 'separator', { name: 'Resize panel' } ) ).not.toBeInTheDocument();
			await act( () => vi.advanceTimersByTime( 120 ) );
			expect( getFrameRoot() ).not.toHaveAttribute( 'data-layout-moving' );
			expect( screen.getByRole( 'separator', { name: 'Resize panel' } ) ).toBeInTheDocument();
		} );

		it( 'slides the ready panel and header together before enabling resizing', async () => {
			const { rerender } = render( frame( 'Loading site', false ) );
			const panel = screen.getByLabelText( 'Panel' );
			rerender( frame( 'Running site', true ) );
			expect( screen.getByRole( 'complementary', { name: 'Panel' } ) ).toBe( panel );
			expect( screen.queryByRole( 'separator', { name: 'Resize panel' } ) ).not.toBeInTheDocument();
			expect( getFrameRoot().style.getPropertyValue( '--panel-layout-duration' ) ).toBe(
				'var(--motion-duration-layout)'
			);
			await act( () => vi.advanceTimersByTime( 240 ) );
			expect( screen.getByRole( 'separator', { name: 'Resize panel' } ) ).toBeInTheDocument();
			expect( screen.getByRole( 'complementary', { name: 'Panel' } ) ).toBe( panel );
		} );

		it( 'keeps the outgoing site through the exit, even when another stopped site is selected', async () => {
			const { rerender } = render( frame( 'Running site', true ) );

			rerender( frame( 'Stopped site', false ) );

			expect( screen.getByLabelText( 'Panel' ) ).toHaveTextContent( 'Running site' );
			expect( screen.getByLabelText( 'Panel' ) ).toHaveAttribute( 'data-collapsed', 'true' );
			expect( screen.queryByRole( 'complementary', { name: 'Panel' } ) ).not.toBeInTheDocument();
			await act( () => vi.advanceTimersByTime( 120 ) );
			rerender( frame( 'Another stopped site', false ) );
			expect( screen.getByLabelText( 'Panel' ) ).toHaveTextContent( 'Running site' );

			await act( () => vi.advanceTimersByTime( 120 ) );

			expect( screen.getByLabelText( 'Panel' ) ).toHaveTextContent( 'Another stopped site' );
			expect( screen.getByLabelText( 'Panel' ) ).toHaveAttribute( 'data-collapsed', 'true' );
		} );

		it( 'shows the incoming running site immediately when the exit is reversed', async () => {
			const { rerender } = render( frame( 'Running site', true ) );
			rerender( frame( 'Stopped site', false ) );
			await act( () => vi.advanceTimersByTime( 120 ) );

			rerender( frame( 'Another running site', true ) );

			expect( screen.getByRole( 'complementary', { name: 'Panel' } ) ).toHaveTextContent(
				'Another running site'
			);
			expect( screen.getByLabelText( 'Panel' ) ).toHaveAttribute( 'data-collapsed', 'false' );
			await act( () => vi.advanceTimersByTime( 240 ) );
			expect( screen.getByRole( 'complementary', { name: 'Panel' } ) ).toHaveTextContent(
				'Another running site'
			);
		} );

		it( 'finishes a manual slide when an instant layout restoration takes over', () => {
			const { rerender } = render( frame( 'Stopped site', false ) );
			rerender( frame( 'Stopped site', true ) );
			expect( screen.queryByRole( 'separator', { name: 'Resize panel' } ) ).not.toBeInTheDocument();
			rerender( frame( 'Starting site', true, true ) );
			expect( screen.getByRole( 'separator', { name: 'Resize panel' } ) ).toBeInTheDocument();
		} );

		it( 'closes immediately when an instant close interrupts an opening panel', async () => {
			const { rerender } = render( frame( 'Stopped site', false ) );
			rerender( frame( 'Running site', true ) );
			await act( () => vi.advanceTimersByTime( 120 ) );

			rerender( frame( 'Stopped site', false, true ) );

			expect( screen.getByLabelText( 'Panel' ) ).toHaveTextContent( 'Stopped site' );
			expect( screen.getByLabelText( 'Panel' ) ).toHaveAttribute( 'data-collapsed', 'true' );
		} );
	} );

	it( 'lays out the panel immediately when mounted open', async () => {
		render(
			<PanelSplitFrame siteId="one" panelOpen panel={ () => <aside aria-label="Panel" /> }>
				<span data-testid="content">Content</span>
			</PanelSplitFrame>
		);

		const root = getFrameRoot();

		await waitFor( () => {
			expect( root ).toHaveStyle( '--panel-frame-content-width: 360px' );
		} );
		expect( screen.getByRole( 'separator', { name: 'Resize panel' } ) ).toHaveAttribute(
			'aria-valuenow',
			'640'
		);
		expect( screen.getByLabelText( 'Panel' ) ).toBeVisible();
	} );

	it( 'shares the resized width across sites and reloads without remounting the panel', () => {
		window.localStorage.setItem( `${ PANEL_CONTENT_WIDTH_STORAGE_KEY }:one`, '620' );
		const frame = ( siteId: string ) => (
			<PanelSplitFrame siteId={ siteId } panelOpen panel={ () => <aside aria-label="Panel" /> }>
				<span data-testid="content">Content</span>
			</PanelSplitFrame>
		);
		const { rerender, unmount } = render( frame( 'one' ) );
		expect( getFrameRoot() ).toHaveStyle( '--panel-frame-content-width: 360px' );
		const panel = screen.getByLabelText( 'Panel' );
		fireEvent.keyDown( screen.getByRole( 'separator' ), { key: 'ArrowRight' } );
		expect( localStorage.getItem( SITE_WIDTH_KEY ) ).toBe( '376' );
		rerender( frame( 'two' ) );
		expect( getFrameRoot() ).toHaveStyle( '--panel-frame-content-width: 376px' );
		expect( screen.getByLabelText( 'Panel' ) ).toBe( panel );
		fireEvent.keyDown( screen.getByRole( 'separator' ), { key: 'ArrowRight', shiftKey: true } );
		expect( localStorage.getItem( PANEL_CONTENT_WIDTH_STORAGE_KEY ) ).toBe( '416' );
		rerender( frame( 'one' ) );
		expect( getFrameRoot() ).toHaveStyle( '--panel-frame-content-width: 416px' );
		unmount();
		render( frame( 'two' ) );
		expect( getFrameRoot() ).toHaveStyle( '--panel-frame-content-width: 416px' );
		expect( screen.getByRole( 'separator', { name: 'Resize panel' } ) ).toHaveAttribute(
			'aria-valuenow',
			'584'
		);
	} );

	it( 'cancels a drag when switching sites without overwriting the shared width', () => {
		localStorage.setItem( SITE_WIDTH_KEY, '500' );
		const frame = ( siteId: string ) => (
			<PanelSplitFrame siteId={ siteId } panelOpen panel={ () => <aside /> }>
				<span data-testid="content">Content</span>
			</PanelSplitFrame>
		);
		const { rerender } = render( frame( 'one' ) );
		fireEvent.mouseDown( screen.getByRole( 'separator' ), { clientX: 500 } );
		rerender( frame( 'two' ) );
		fireEvent.mouseUp( document, { clientX: 620 } );
		expect( document.body ).not.toHaveStyle( { cursor: 'col-resize' } );
		expect( localStorage.getItem( SITE_WIDTH_KEY ) ).toBe( '500' );
		expect( localStorage.getItem( `${ PANEL_CONTENT_WIDTH_STORAGE_KEY }:two` ) ).toBeNull();
		expect( getFrameRoot() ).toHaveStyle( '--panel-frame-content-width: 500px' );
	} );

	it( 'keeps the content width stable as the window grows', async () => {
		render(
			<PanelSplitFrame siteId="one" panelOpen panel={ () => <aside aria-label="Panel" /> }>
				<span data-testid="content">Content</span>
			</PanelSplitFrame>
		);

		const root = getFrameRoot();
		await waitFor( () => {
			expect( root ).toHaveStyle( '--panel-frame-content-width: 360px' );
		} );

		frameWidth = 1120;
		fireEvent( window, new Event( 'resize' ) );

		expect( root ).toHaveStyle( '--panel-frame-content-width: 360px' );

		frameWidth = 1300;
		fireEvent( window, new Event( 'resize' ) );

		expect( root ).toHaveStyle( '--panel-frame-content-width: 360px' );
	} );

	describe( 'window controls corner', () => {
		function renderFrame(
			sidebarCollapsed: boolean,
			props: Partial< ComponentProps< typeof PanelSplitFrame > >
		) {
			render(
				<SidebarCollapsedContext.Provider value={ sidebarCollapsed }>
					<PanelSplitFrame siteId="one" panel={ () => <CornerProbe testId="panel" /> } { ...props }>
						<span data-testid="content">Content</span>
						<CornerProbe testId="chat" />
					</PanelSplitFrame>
				</SidebarCollapsedContext.Provider>
			);
			return {
				chat: screen.getByTestId( 'chat' ).dataset.inCorner,
				panel: screen.getByTestId( 'panel' ).dataset.inCorner,
			};
		}

		it( 'puts the chat in the corner when the panel is closed', () => {
			expect( renderFrame( true, {} ) ).toEqual( { chat: 'true', panel: 'false' } );
		} );

		it( 'puts the panel in the corner when it is open', () => {
			expect( renderFrame( true, { panelOpen: true } ) ).toEqual( {
				chat: 'false',
				panel: 'true',
			} );
		} );
	} );

	it( 'keeps panel space reserved when the first mount measurement is zero', () => {
		frameWidth = 0;

		render(
			<PanelSplitFrame siteId="one" panelOpen panel={ () => <aside aria-label="Panel" /> }>
				<span data-testid="content">Content</span>
			</PanelSplitFrame>
		);

		const root = getFrameRoot();
		expect( root ).toHaveStyle( '--panel-frame-content-width: 360px' );
		expect( screen.getByLabelText( 'Panel' ) ).toBeVisible();
	} );

	it( 'keeps the panel open in a narrow frame, split in proportion and not resizable', async () => {
		frameWidth = 544;

		render(
			<PanelSplitFrame siteId="one" panelOpen panel={ () => <aside aria-label="Panel" /> }>
				<span data-testid="content">Content</span>
			</PanelSplitFrame>
		);

		await waitFor( () =>
			expect( getFrameRoot() ).toHaveStyle( '--panel-frame-content-width: 272px' )
		);
		expect( screen.getByLabelText( 'Panel' ) ).toBeVisible();
		expect( screen.queryByRole( 'separator' ) ).not.toBeInTheDocument();
	} );

	describe( 'keyboard and pointer resizing', () => {
		async function renderOpenAndSettle() {
			render(
				<PanelSplitFrame siteId="one" panelOpen panel={ () => <aside aria-label="Panel" /> }>
					<span data-testid="content">Content</span>
				</PanelSplitFrame>
			);
			await waitFor( () =>
				expect( getFrameRoot() ).toHaveStyle( '--panel-frame-content-width: 360px' )
			);
			return screen.getByRole( 'separator', { name: 'Resize panel' } );
		}

		it( 'collapses the panel to its minimum width on Home', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.keyDown( handle, { key: 'Home' } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '360' );
			expect( window.localStorage.getItem( SITE_WIDTH_KEY ) ).toBe( '640' );
		} );

		it( 'expands the panel to its maximum width on End', async () => {
			const handle = await renderOpenAndSettle();
			fireEvent.keyDown( handle, { key: 'End' } );
			expect( handle ).toHaveAttribute( 'aria-valuenow', '640' );
			expect( window.localStorage.getItem( SITE_WIDTH_KEY ) ).toBe( '360' );
		} );

		it( 'steps the panel width with arrow keys, using a larger step with Shift', async () => {
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

		it( 'cleans up document drag state if the panel closes mid-resize', async () => {
			const panel = () => <aside aria-label="Panel" />;
			const { rerender } = render(
				<PanelSplitFrame siteId="one" panelOpen panel={ panel }>
					<span data-testid="content">Content</span>
				</PanelSplitFrame>
			);
			const handle = await screen.findByRole( 'separator', { name: 'Resize panel' } );

			fireEvent.mouseDown( handle, { button: 0, clientX: 500 } );
			expect( document.body ).toHaveStyle( { cursor: 'col-resize' } );
			expect( document.body ).toHaveStyle( { userSelect: 'none' } );

			rerender(
				<PanelSplitFrame siteId="one" panelOpen={ false } panel={ panel }>
					<span data-testid="content">Content</span>
				</PanelSplitFrame>
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
