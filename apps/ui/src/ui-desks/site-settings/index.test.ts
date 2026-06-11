import { describe, expect, it } from 'vitest';
import { isDesksSiteSettingsTab, validateDesksSiteSettingsSearch } from './index';

describe( 'desks site settings route search', () => {
	it( 'accepts known site settings tabs', () => {
		expect( isDesksSiteSettingsTab( 'general' ) ).toBe( true );
		expect( isDesksSiteSettingsTab( 'debugging' ) ).toBe( true );
	} );

	it( 'drops unknown tab values from search params', () => {
		expect( validateDesksSiteSettingsSearch( { tab: 'missing' } ) ).toEqual( {} );
		expect( validateDesksSiteSettingsSearch( { tab: 1 } ) ).toEqual( {} );
	} );

	it( 'keeps valid tab values in search params', () => {
		expect( validateDesksSiteSettingsSearch( { tab: 'debugging' } ) ).toEqual( {
			tab: 'debugging',
		} );
	} );
} );
