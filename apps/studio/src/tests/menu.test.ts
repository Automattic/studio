/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';
import { buildViewMenuItems } from 'src/menu';

function buildTestViewMenuItems(
	overrides: Partial< Parameters< typeof buildViewMenuItems >[ 0 ] > = {}
) {
	return buildViewMenuItems( {
		isDevelopment: false,
		isAlwaysOnTop: false,
		devTools: [],
		onToggleSidebar: vi.fn(),
		onTogglePanel: vi.fn(),
		onSetWorkspaceLayout: vi.fn(),
		onResetZoom: vi.fn(),
		onZoomIn: vi.fn(),
		onZoomOut: vi.fn(),
		...overrides,
	} );
}

describe( 'buildViewMenuItems', () => {
	it( 'keeps the panel command wired to the expected shortcut and callback', () => {
		const onTogglePanel = vi.fn();
		const items = buildTestViewMenuItems( { onTogglePanel } );
		const togglePanelItem = items.find( ( item ) => item.label === 'Toggle Panel' );

		expect( togglePanelItem ).toMatchObject( { accelerator: 'CommandOrControl+Shift+B' } );

		togglePanelItem?.click?.( {} as never, undefined as never, undefined as never );

		expect( onTogglePanel ).toHaveBeenCalledTimes( 1 );
	} );

	it.each( [
		[ 'Actual Size', 'CommandOrControl+0', 'onResetZoom' ],
		[ 'Zoom In', 'CommandOrControl+Plus', 'onZoomIn' ],
		[ 'Zoom Out', 'CommandOrControl+-', 'onZoomOut' ],
	] as const )( 'targets the app for %s', ( label, accelerator, callbackName ) => {
		const callback = vi.fn();
		const item = buildTestViewMenuItems( { [ callbackName ]: callback } ).find(
			( candidate ) => candidate.label === label
		);

		expect( item ).toMatchObject( { accelerator } );
		expect( item?.role ).toBeUndefined();

		item?.click?.( {} as never, undefined as never, undefined as never );

		expect( callback ).toHaveBeenCalledTimes( 1 );
	} );
} );

it.each( [
	[ 'Chat', '1', 'chat' ],
	[ 'Split view', '2', 'split' ],
	[ 'Panel', '3', 'panel' ],
] as const )( 'selects %s with an app-local shortcut', ( label, key, layout ) => {
	const onSetWorkspaceLayout = vi.fn();
	const item = buildTestViewMenuItems( { onSetWorkspaceLayout } ).find(
		( item ) => item.label === label
	);
	expect( item ).toMatchObject( { accelerator: `CommandOrControl+${ key }` } );
	item?.click?.( {} as never, undefined as never, undefined as never );
	expect( onSetWorkspaceLayout ).toHaveBeenCalledExactlyOnceWith( layout );
} );
