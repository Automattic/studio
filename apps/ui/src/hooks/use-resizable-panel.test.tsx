import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResizeHandle } from '@/components/resize-handle';
import { useResizablePanel } from '@/hooks/use-resizable-panel';
import { SIDEBAR_PANEL_CONFIG, SIDEBAR_PANEL_STORAGE_KEY } from '@/lib/resizable-panels';

// Wires the hook exactly as SidebarLayout does (edge 'right', sidebar config +
// key) so this covers the shared usePointerDrag path through useResizablePanel.
function SidebarHarness() {
	const resize = useResizablePanel( {
		config: SIDEBAR_PANEL_CONFIG,
		edge: 'right',
		storageKey: SIDEBAR_PANEL_STORAGE_KEY,
	} );
	return (
		<ResizeHandle
			label="Resize sidebar"
			minWidth={ resize.minWidth }
			maxWidth={ resize.maxWidth }
			width={ resize.width }
			isResizing={ resize.isResizing }
			onResizeStart={ resize.handleResizeStart }
			onKeyDown={ resize.handleKeyDown }
		/>
	);
}

describe( 'useResizablePanel (sidebar wiring)', () => {
	let originalInnerWidth: number;

	beforeEach( () => {
		originalInnerWidth = window.innerWidth;
		// Wide enough for a useful range: max = floor(1600 * 0.25) = 400, min 240,
		// default 320.
		Object.defineProperty( window, 'innerWidth', { value: 1600, configurable: true } );
	} );

	afterEach( () => {
		Object.defineProperty( window, 'innerWidth', {
			value: originalInnerWidth,
			configurable: true,
		} );
		window.localStorage.removeItem( SIDEBAR_PANEL_STORAGE_KEY );
	} );

	function renderHarness() {
		render( <SidebarHarness /> );
		return screen.getByRole( 'separator', { name: 'Resize sidebar' } );
	}

	it( 'starts at the default width within the configured bounds', () => {
		const handle = renderHarness();
		expect( handle ).toHaveAttribute( 'aria-valuenow', '320' );
		expect( handle ).toHaveAttribute( 'aria-valuemin', '240' );
		expect( handle ).toHaveAttribute( 'aria-valuemax', '400' );
	} );

	it( 'persists a rightward drag (edge: right grows the panel)', () => {
		const handle = renderHarness();
		fireEvent.mouseDown( handle, { button: 0, clientX: 500 } );
		fireEvent.mouseUp( document, { clientX: 560 } );
		expect( handle ).toHaveAttribute( 'aria-valuenow', '380' );
		expect( window.localStorage.getItem( SIDEBAR_PANEL_STORAGE_KEY ) ).toBe( '380' );
	} );

	it( 'clamps a drag to the configured maximum', () => {
		const handle = renderHarness();
		fireEvent.mouseDown( handle, { button: 0, clientX: 500 } );
		fireEvent.mouseUp( document, { clientX: 900 } );
		expect( handle ).toHaveAttribute( 'aria-valuenow', '400' );
		expect( window.localStorage.getItem( SIDEBAR_PANEL_STORAGE_KEY ) ).toBe( '400' );
	} );

	it( 'steps with arrow keys and jumps to the bounds with Home/End', () => {
		const handle = renderHarness();
		fireEvent.keyDown( handle, { key: 'ArrowRight' } );
		expect( handle ).toHaveAttribute( 'aria-valuenow', '336' );
		fireEvent.keyDown( handle, { key: 'ArrowLeft', shiftKey: true } );
		expect( handle ).toHaveAttribute( 'aria-valuenow', '296' );
		fireEvent.keyDown( handle, { key: 'End' } );
		expect( handle ).toHaveAttribute( 'aria-valuenow', '400' );
		fireEvent.keyDown( handle, { key: 'Home' } );
		expect( handle ).toHaveAttribute( 'aria-valuenow', '240' );
	} );

	it( 'ignores non-primary mouse buttons', () => {
		const handle = renderHarness();
		fireEvent.mouseDown( handle, { button: 2, clientX: 500 } );
		fireEvent.mouseUp( document, { clientX: 900 } );
		expect( handle ).toHaveAttribute( 'aria-valuenow', '320' );
		expect( window.localStorage.getItem( SIDEBAR_PANEL_STORAGE_KEY ) ).toBeNull();
	} );
} );
