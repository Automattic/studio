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
	it.each( [ 'darwin', 'win32', 'linux' ] )( 'toggles fullscreen on %s', ( platform ) => {
		const originalPlatform = process.platform;
		Object.defineProperty( process, 'platform', { value: platform, configurable: true } );
		try {
			const item = buildTestViewMenuItems().find(
				( candidate ) => candidate.label === 'Toggle Fullscreen'
			);
			if ( platform === 'darwin' ) {
				expect( item?.role ).toBeUndefined();
				expect( item?.accelerator ).toBe( 'Control+Command+F' );
				const window = { isFullScreen: vi.fn().mockReturnValue( false ), setFullScreen: vi.fn() };
				item?.click?.( {} as never, window as never, undefined as never );
				expect( window.setFullScreen ).toHaveBeenLastCalledWith( true );
				window.isFullScreen.mockReturnValue( true );
				item?.click?.( {} as never, window as never, undefined as never );
				expect( window.setFullScreen ).toHaveBeenLastCalledWith( false );
			} else {
				expect( item?.role ).toBe( 'togglefullscreen' );
			}
		} finally {
			Object.defineProperty( process, 'platform', { value: originalPlatform, configurable: true } );
		}
	} );

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
