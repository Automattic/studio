import { describe, expect, it } from 'vitest';
import { isSiteSettingsTab, siteSettingsTabToPanel } from './index';

describe( 'isSiteSettingsTab', () => {
	it( 'accepts the known tab ids', () => {
		expect( isSiteSettingsTab( 'overview' ) ).toBe( true );
		expect( isSiteSettingsTab( 'general' ) ).toBe( true );
		expect( isSiteSettingsTab( 'debugging' ) ).toBe( true );
	} );

	it( 'rejects anything else', () => {
		expect( isSiteSettingsTab( 'settings' ) ).toBe( false );
		expect( isSiteSettingsTab( '' ) ).toBe( false );
	} );
} );

describe( 'siteSettingsTabToPanel', () => {
	it( 'maps the General tab to the shared "settings" panel', () => {
		expect( siteSettingsTabToPanel( 'general' ) ).toBe( 'settings' );
	} );

	it( 'keeps overview and debugging as-is', () => {
		expect( siteSettingsTabToPanel( 'overview' ) ).toBe( 'overview' );
		expect( siteSettingsTabToPanel( 'debugging' ) ).toBe( 'debugging' );
	} );
} );
