import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useResponsivePanels } from './use-responsive-panels';

function setViewportWidth( width: number ) {
	Object.defineProperty( window, 'innerWidth', { configurable: true, value: width } );
}

describe( 'useResponsivePanels', () => {
	const originalInnerWidth = window.innerWidth;

	afterEach( () => {
		setViewportWidth( originalInnerWidth );
		vi.restoreAllMocks();
	} );

	it( 'grows the window to preserve the sidebar when opening the preview', async () => {
		setViewportWidth( 1024 );
		const ensureWindowWidth = vi.fn().mockResolvedValue( 1024 );
		const setPreviewOpen = vi.fn();

		renderHook( () =>
			useResponsivePanels( {
				connector: { ensureWindowWidth },
				previewOpen: true,
				previewFullscreen: false,
				setPreviewOpen,
			} )
		);

		await waitFor( () => expect( ensureWindowWidth ).toHaveBeenCalledWith( 932 ) );
		expect( setPreviewOpen ).not.toHaveBeenCalled();
	} );

	it( 'collapses the sidebar when the window cannot grow enough for all panels', async () => {
		setViewportWidth( 700 );
		const ensureWindowWidth = vi.fn().mockResolvedValueOnce( 800 ).mockResolvedValueOnce( 680 );

		const { result } = renderHook( () =>
			useResponsivePanels( {
				connector: { ensureWindowWidth },
				previewOpen: true,
				previewFullscreen: false,
				setPreviewOpen: vi.fn(),
			} )
		);

		await waitFor( () => expect( result.current.sidebarCollapsed ).toBe( true ) );
		expect( ensureWindowWidth ).toHaveBeenNthCalledWith( 1, 932 );
		expect( ensureWindowWidth ).toHaveBeenNthCalledWith( 2, 680 );
	} );

	it( 'closes the preview when the settled split is manually resized below its minimum', async () => {
		setViewportWidth( 420 );
		const setPreviewOpen = vi.fn();
		const ensureWindowWidth = vi.fn().mockResolvedValue( 680 );
		const { result } = renderHook( () =>
			useResponsivePanels( {
				connector: { ensureWindowWidth },
				previewOpen: true,
				previewFullscreen: false,
				setPreviewOpen,
			} )
		);

		act( () => result.current.onPreviewContainerWidthChange( 420 ) );
		expect( setPreviewOpen ).not.toHaveBeenCalled();

		await waitFor( () => expect( ensureWindowWidth ).toHaveBeenCalledWith( 680 ) );
		act( () => result.current.onPreviewContainerWidthChange( 679 ) );
		expect( setPreviewOpen ).toHaveBeenCalledWith( false );
	} );

	it( 'closes the preview if necessary before reopening the sidebar', async () => {
		setViewportWidth( 420 );
		const ensureWindowWidth = vi
			.fn()
			.mockResolvedValueOnce( 680 )
			.mockResolvedValueOnce( 800 )
			.mockResolvedValueOnce( 660 );
		const setPreviewOpen = vi.fn();
		const { result } = renderHook( () =>
			useResponsivePanels( {
				connector: { ensureWindowWidth },
				previewOpen: true,
				previewFullscreen: false,
				setPreviewOpen,
			} )
		);

		await waitFor( () => expect( ensureWindowWidth ).toHaveBeenCalledWith( 680 ) );
		await act( () => result.current.openSidebar() );

		expect( setPreviewOpen ).toHaveBeenCalledWith( false );
		expect( ensureWindowWidth ).toHaveBeenNthCalledWith( 1, 680 );
		expect( ensureWindowWidth ).toHaveBeenNthCalledWith( 2, 932 );
		expect( ensureWindowWidth ).toHaveBeenNthCalledWith( 3, 660 );
		expect( result.current.sidebarCollapsed ).toBe( false );
	} );

	it( 'collapses the sidebar when the window is dragged below the breakpoint', () => {
		setViewportWidth( 900 );
		const { result } = renderHook( () =>
			useResponsivePanels( {
				connector: { ensureWindowWidth: vi.fn().mockResolvedValue( 900 ) },
				previewOpen: false,
				previewFullscreen: false,
				setPreviewOpen: vi.fn(),
			} )
		);

		expect( result.current.sidebarCollapsed ).toBe( false );

		act( () => {
			setViewportWidth( 600 );
			window.dispatchEvent( new Event( 'resize' ) );
		} );

		expect( result.current.sidebarCollapsed ).toBe( true );
	} );

	it( 'keeps the sidebar open while a panel grow is still widening the window', async () => {
		setViewportWidth( 700 );
		let resolveGrow: ( ( width: number ) => void ) | undefined;
		const ensureWindowWidth = vi.fn(
			() =>
				new Promise< number >( ( resolve ) => {
					resolveGrow = resolve;
				} )
		);
		const { result } = renderHook( () =>
			useResponsivePanels( {
				connector: { ensureWindowWidth },
				previewOpen: true,
				previewFullscreen: false,
				setPreviewOpen: vi.fn(),
			} )
		);

		// Opening the preview grows the window for both panels; the sidebar stays
		// open until that resolves.
		expect( result.current.sidebarCollapsed ).toBe( false );

		// A stale, still-narrow resize arriving mid-grow must not collapse the
		// panel we are in the middle of making room for.
		act( () => {
			setViewportWidth( 600 );
			window.dispatchEvent( new Event( 'resize' ) );
		} );
		expect( result.current.sidebarCollapsed ).toBe( false );

		await act( async () => {
			resolveGrow?.( 932 );
		} );
		expect( result.current.sidebarCollapsed ).toBe( false );
	} );

	it( 'ignores a stale narrow resize that lands right after opening the sidebar', async () => {
		setViewportWidth( 420 );
		const ensureWindowWidth = vi.fn().mockResolvedValue( 660 );
		const { result } = renderHook( () =>
			useResponsivePanels( {
				connector: { ensureWindowWidth },
				previewOpen: false,
				previewFullscreen: false,
				setPreviewOpen: vi.fn(),
			} )
		);

		expect( result.current.sidebarCollapsed ).toBe( true );

		await act( async () => {
			await result.current.openSidebar();
		} );
		expect( result.current.sidebarCollapsed ).toBe( false );

		// The window has grown, but the renderer's matching resize event lands
		// late and still reports the old narrow width. The grow guard must keep
		// the just-opened sidebar from snapping shut.
		act( () => {
			window.dispatchEvent( new Event( 'resize' ) );
		} );
		expect( result.current.sidebarCollapsed ).toBe( false );
	} );

	it( 'reserves room for the split before leaving fullscreen to show the sidebar', async () => {
		setViewportWidth( 420 );
		const ensureWindowWidth = vi.fn().mockResolvedValue( 932 );
		const { result } = renderHook( () =>
			useResponsivePanels( {
				connector: { ensureWindowWidth },
				previewOpen: true,
				previewFullscreen: true,
				setPreviewOpen: vi.fn(),
			} )
		);

		await act( () => result.current.openSidebar() );

		expect( ensureWindowWidth ).toHaveBeenCalledWith( 932 );
		expect( result.current.sidebarCollapsed ).toBe( false );
	} );
} );
