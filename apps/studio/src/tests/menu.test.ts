/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildViewMenuItems } from 'src/menu';

const originalEnableAgenticUi = process.env.ENABLE_AGENTIC_UI;

function buildTestViewMenuItems(
	overrides: Partial< Parameters< typeof buildViewMenuItems >[ 0 ] > = {}
) {
	return buildViewMenuItems( {
		needsOnboarding: false,
		isDevelopment: false,
		isAlwaysOnTop: false,
		devTools: [],
		onToggleSidebar: vi.fn(),
		onToggleSitePreview: vi.fn(),
		...overrides,
	} );
}

function getLabels( items = buildTestViewMenuItems() ) {
	return items.map( ( item ) => item.label ).filter( Boolean );
}

describe( 'buildViewMenuItems', () => {
	beforeEach( () => {
		delete process.env.ENABLE_AGENTIC_UI;
	} );

	afterEach( () => {
		if ( originalEnableAgenticUi === undefined ) {
			delete process.env.ENABLE_AGENTIC_UI;
			return;
		}

		process.env.ENABLE_AGENTIC_UI = originalEnableAgenticUi;
	} );

	it( 'hides the site preview menu item when the agentic UI is disabled', () => {
		expect( getLabels() ).not.toContain( 'Toggle Site Preview' );
	} );

	it( 'shows the site preview menu item when the agentic UI is enabled', () => {
		process.env.ENABLE_AGENTIC_UI = 'true';

		expect( getLabels() ).toContain( 'Toggle Site Preview' );
	} );

	it( 'keeps the site preview command wired to the expected shortcut and callback', () => {
		process.env.ENABLE_AGENTIC_UI = 'true';
		const onToggleSitePreview = vi.fn();
		const items = buildTestViewMenuItems( { onToggleSitePreview } );
		const toggleSitePreviewItem = items.find( ( item ) => item.label === 'Toggle Site Preview' );

		expect( toggleSitePreviewItem ).toMatchObject( {
			accelerator: 'CommandOrControl+Shift+B',
			enabled: true,
		} );

		toggleSitePreviewItem?.click?.( {} as never, undefined as never, undefined as never );

		expect( onToggleSitePreview ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'disables the site preview command during onboarding', () => {
		process.env.ENABLE_AGENTIC_UI = 'true';
		const toggleSitePreviewItem = buildTestViewMenuItems( { needsOnboarding: true } ).find(
			( item ) => item.label === 'Toggle Site Preview'
		);

		expect( toggleSitePreviewItem ).toMatchObject( { enabled: false } );
	} );

	it( 'keeps development tools after the site preview command', () => {
		process.env.ENABLE_AGENTIC_UI = 'true';

		expect(
			getLabels(
				buildTestViewMenuItems( {
					isDevelopment: true,
					devTools: [ { label: 'Reload', role: 'reload' } ],
				} )
			)
		).toEqual( [
			'Toggle Sidebar',
			'Toggle Site Preview',
			'Reload',
			'Actual Size',
			'Zoom In',
			'Zoom Out',
			'Toggle Fullscreen',
			'Float on Top of All Other Windows',
		] );
	} );
} );
