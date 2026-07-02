import { describe, expect, it, vi } from 'vitest';
import {
	accountFromCookies,
	isWordPressOrgDomain,
	usernameFromLoggedInCookieValue,
} from '../wordpress-org-auth';

// Login drives real Chrome via Playwright; the pure helpers under test don't
// touch it, but importing the module pulls playwright-core in — stub it so
// the unit tests stay fast and headless.
vi.mock( 'playwright-core', () => ( {
	chromium: { launchPersistentContext: vi.fn() },
} ) );

describe( 'isWordPressOrgDomain', () => {
	it( 'accepts wordpress.org and its subdomains', () => {
		expect( isWordPressOrgDomain( 'wordpress.org' ) ).toBe( true );
		expect( isWordPressOrgDomain( '.wordpress.org' ) ).toBe( true );
		expect( isWordPressOrgDomain( 'login.wordpress.org' ) ).toBe( true );
		expect( isWordPressOrgDomain( 'profiles.wordpress.org' ) ).toBe( true );
	} );

	it( 'rejects lookalike domains', () => {
		expect( isWordPressOrgDomain( 'evilwordpress.org' ) ).toBe( false );
		expect( isWordPressOrgDomain( 'wordpress.org.evil.com' ) ).toBe( false );
		expect( isWordPressOrgDomain( 'wordpress.com' ) ).toBe( false );
	} );
} );

describe( 'usernameFromLoggedInCookieValue', () => {
	it( 'extracts the username segment', () => {
		expect( usernameFromLoggedInCookieValue( 'shaunandrews|abc123|def456' ) ).toBe(
			'shaunandrews'
		);
	} );

	it( 'decodes URI-encoded values', () => {
		expect( usernameFromLoggedInCookieValue( 'shaun%20andrews%7Cabc' ) ).toBe( 'shaun andrews' );
	} );

	it( 'returns undefined for empty values', () => {
		expect( usernameFromLoggedInCookieValue( '' ) ).toBeUndefined();
		expect( usernameFromLoggedInCookieValue( '|token' ) ).toBeUndefined();
	} );
} );

describe( 'accountFromCookies', () => {
	it( 'finds the logged_in cookie on a wordpress.org domain', () => {
		const account = accountFromCookies( [
			{ name: 'devicePixels', value: '2', domain: '.wordpress.org' },
			{
				name: 'wporg_logged_in',
				value: 'shaunandrews|token|expiry',
				domain: '.wordpress.org',
			},
		] );
		expect( account ).toEqual( {
			username: 'shaunandrews',
			profileUrl: 'https://profiles.wordpress.org/shaunandrews/',
		} );
	} );

	it( 'ignores logged_in cookies from other domains', () => {
		expect(
			accountFromCookies( [
				{ name: 'wordpress_logged_in_abc', value: 'user|token', domain: 'example.com' },
			] )
		).toBeUndefined();
	} );

	it( 'returns undefined with no matching cookie', () => {
		expect( accountFromCookies( [] ) ).toBeUndefined();
	} );
} );
