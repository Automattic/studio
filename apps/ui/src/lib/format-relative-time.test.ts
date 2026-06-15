import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRelativeTime } from './format-relative-time';

const NOW = '2026-05-03T12:00:00.000Z';

describe( 'formatRelativeTime', () => {
	beforeEach( () => {
		vi.useFakeTimers();
		vi.setSystemTime( new Date( NOW ) );
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'returns an empty string for unparseable timestamps', () => {
		expect( formatRelativeTime( 'not-a-date' ) ).toBe( '' );
	} );

	it( 'returns "now" under a minute', () => {
		expect( formatRelativeTime( NOW ) ).toBe( 'now' );
		expect( formatRelativeTime( '2026-05-03T11:59:01.000Z' ) ).toBe( 'now' );
	} );

	it( 'clamps future timestamps to "now"', () => {
		expect( formatRelativeTime( '2026-05-03T13:00:00.000Z' ) ).toBe( 'now' );
	} );

	it( 'formats minutes up to an hour', () => {
		expect( formatRelativeTime( '2026-05-03T11:59:00.000Z' ) ).toBe( '1m' );
		expect( formatRelativeTime( '2026-05-03T11:01:00.000Z' ) ).toBe( '59m' );
	} );

	it( 'formats hours up to a day', () => {
		expect( formatRelativeTime( '2026-05-03T11:00:00.000Z' ) ).toBe( '1h' );
		expect( formatRelativeTime( '2026-05-02T13:00:00.000Z' ) ).toBe( '23h' );
	} );

	it( 'formats days beyond that', () => {
		expect( formatRelativeTime( '2026-05-02T12:00:00.000Z' ) ).toBe( '1d' );
		expect( formatRelativeTime( '2026-05-01T12:00:00.000Z' ) ).toBe( '2d' );
		expect( formatRelativeTime( '2026-03-03T12:00:00.000Z' ) ).toBe( '61d' );
	} );
} );
