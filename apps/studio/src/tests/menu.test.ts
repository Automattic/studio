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
		onToggleSitePreview: vi.fn(),
		onResetZoom: vi.fn(),
		onZoomIn: vi.fn(),
		onZoomOut: vi.fn(),
		...overrides,
	} );
}

describe( 'buildViewMenuItems', () => {
	it( 'keeps the site preview command wired to the expected shortcut and callback', () => {
		const onToggleSitePreview = vi.fn();
		const items = buildTestViewMenuItems( { onToggleSitePreview } );
		const toggleSitePreviewItem = items.find( ( item ) => item.label === 'Toggle Site Preview' );

		expect( toggleSitePreviewItem ).toMatchObject( { accelerator: 'CommandOrControl+Shift+B' } );

		toggleSitePreviewItem?.click?.( {} as never, undefined as never, undefined as never );

		expect( onToggleSitePreview ).toHaveBeenCalledTimes( 1 );
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
