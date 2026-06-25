/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';
import { getViewMenuItems } from 'src/lib/view-menu-items';

function getLabels( isAgenticUiEnabled: boolean ) {
	return getViewMenuItems( {
		needsOnboarding: false,
		isAgenticUiEnabled,
		isDevelopment: false,
		isAlwaysOnTop: false,
		devTools: [],
		onToggleSitePreview: vi.fn(),
	} )
		.map( ( item ) => item.label )
		.filter( Boolean );
}

describe( 'getViewMenuItems', () => {
	it( 'hides the site preview menu item when the agentic UI is disabled', () => {
		expect( getLabels( false ) ).not.toContain( 'Toggle Site Preview' );
	} );

	it( 'shows the site preview menu item when the agentic UI is enabled', () => {
		expect( getLabels( true ) ).toContain( 'Toggle Site Preview' );
	} );
} );
