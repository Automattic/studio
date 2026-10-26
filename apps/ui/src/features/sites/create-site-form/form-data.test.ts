import { generateCustomDomainFromSiteName } from '@studio/common/lib/domains';
import { describe, expect, it } from 'vitest';
import {
	applyFormChange,
	applyInitialValues,
	createDefaultFormData,
	findOfferedWpVersion,
	getSubmittedValues,
	getSuggestedFields,
} from './form-data';

const defaults = createDefaultFormData();

describe( 'applyInitialValues', () => {
	it( 'applies suggested values and treats a suggested folder as picked', () => {
		const next = applyInitialValues( defaults, { name: 'Shop', path: '/sites/shop' }, defaults );

		expect( next ).toMatchObject( { name: 'Shop', path: '/sites/shop', hasCustomPath: true } );
	} );

	it( 'restores defaults for suggestions that went away, but keeps what the person edited', () => {
		const previous = getSuggestedFields( { phpVersion: '8.2', adminEmail: 'a@b.c' } );
		const current = { ...defaults, phpVersion: '8.2' as const, adminEmail: 'mine@b.c' };

		const next = applyInitialValues( current, {}, defaults, previous, new Set( [ 'adminEmail' ] ) );

		expect( next.phpVersion ).toBe( defaults.phpVersion );
		expect( next.adminEmail ).toBe( 'mine@b.c' );
	} );

	it( 'returns the same state when nothing changes', () => {
		expect( applyInitialValues( defaults, {}, defaults ) ).toBe( defaults );
	} );
} );

describe( 'applyFormChange', () => {
	it( 'waits for a new folder when the name changes, unless one was picked', () => {
		expect( applyFormChange( defaults, { name: 'Shop' } ) ).toMatchObject( {
			name: 'Shop',
			isPathPending: true,
		} );
		const picked = { ...defaults, path: '/sites/mine', hasCustomPath: true };
		expect( applyFormChange( picked, { name: 'Shop' } ) ).toMatchObject( {
			path: '/sites/mine',
			isPathPending: false,
		} );
	} );

	it( 'seeds the custom domain from the site name on first toggle', () => {
		const named = { ...defaults, name: 'My Shop' };
		expect( applyFormChange( named, { useCustomDomain: true } ).customDomain ).toBe(
			generateCustomDomainFromSiteName( 'My Shop' )
		);
	} );
} );

describe( 'getSubmittedValues', () => {
	it( 'trims the name and leaves the domain and HTTPS off without a custom domain', () => {
		const values = getSubmittedValues( { ...defaults, name: ' Shop ', enableHttps: true } );

		expect( values ).toMatchObject( { name: 'Shop', customDomain: undefined, enableHttps: false } );
	} );
} );

describe( 'findOfferedWpVersion', () => {
	const offered = [
		{ label: '6.6.2', value: '6.6.2', isBeta: false, isDevelopment: false },
		{ label: '6.5.5', value: '6.5.5', isBeta: false, isDevelopment: false },
	];

	it( "offers a branch's newest release for a version the list doesn't name", () => {
		expect( findOfferedWpVersion( '6.6.2', offered ) ).toBe( '6.6.2' );
		expect( findOfferedWpVersion( '6.5', offered ) ).toBe( '6.5.5' );
		expect( findOfferedWpVersion( '6.5.1', offered ) ).toBe( '6.5.5' );
		expect( findOfferedWpVersion( '5.9', offered ) ).toBeUndefined();
	} );
} );
