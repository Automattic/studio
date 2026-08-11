import { describe, expect, it } from 'vitest';
import { getActiveAnnouncements, type Announcement } from './announcements';

const base: Announcement = {
	id: 'announcement:test',
	title: 'Test',
};

describe( 'getActiveAnnouncements', () => {
	it( 'includes announcements with no date window', () => {
		expect( getActiveAnnouncements( [ base ], new Date( '2026-07-03T12:00:00Z' ) ) ).toHaveLength(
			1
		);
	} );

	it( 'treats startsAt as inclusive and endsAt as exclusive', () => {
		const windowed: Announcement = {
			...base,
			startsAt: '2026-07-01T00:00:00Z',
			endsAt: '2026-07-08T00:00:00Z',
		};

		expect(
			getActiveAnnouncements( [ windowed ], new Date( '2026-06-30T23:59:59Z' ) )
		).toHaveLength( 0 );
		expect(
			getActiveAnnouncements( [ windowed ], new Date( '2026-07-01T00:00:00Z' ) )
		).toHaveLength( 1 );
		expect(
			getActiveAnnouncements( [ windowed ], new Date( '2026-07-07T23:59:59Z' ) )
		).toHaveLength( 1 );
		expect(
			getActiveAnnouncements( [ windowed ], new Date( '2026-07-08T00:00:00Z' ) )
		).toHaveLength( 0 );
	} );

	it( 'supports open-ended windows', () => {
		const openStart: Announcement = { ...base, endsAt: '2026-07-08T00:00:00Z' };
		const openEnd: Announcement = { ...base, startsAt: '2026-07-01T00:00:00Z' };

		expect(
			getActiveAnnouncements( [ openStart ], new Date( '2020-01-01T00:00:00Z' ) )
		).toHaveLength( 1 );
		expect(
			getActiveAnnouncements( [ openEnd ], new Date( '2030-01-01T00:00:00Z' ) )
		).toHaveLength( 1 );
	} );
} );
