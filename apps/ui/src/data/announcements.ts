// Announcements shown as persistent cards in the sidebar footer: marketing
// moments, feature launches, specials. v1 ships content statically in-repo;
// a remote source (WordPress.com endpoint) can replace `ANNOUNCEMENTS` later
// without touching rendering or dismissal, which only see the shape below.

export interface Announcement {
	// Globally unique forever — it doubles as the persisted dismissal key, so
	// reusing an id would leave a new announcement pre-dismissed.
	id: string;
	intent?: 'info' | 'success';
	title: string;
	description?: string;
	cta?: { label: string; url: string };
	// ISO 8601. `startsAt` inclusive, `endsAt` exclusive; either may be
	// omitted for an open-ended window.
	startsAt?: string;
	endsAt?: string;
}

export const ANNOUNCEMENTS: Announcement[] = [
	{
		id: 'announcement:2026-july4-sale',
		intent: 'info',
		title: '4th of July sale',
		description: 'Save 40% on your first year of WordPress.com hosting through July 7.',
		cta: { label: 'See the deal', url: 'https://wordpress.com/pricing/' },
		startsAt: '2026-07-01T00:00:00Z',
		endsAt: '2026-07-08T00:00:00Z',
	},
];

export function getActiveAnnouncements( announcements: Announcement[], now: Date ): Announcement[] {
	const time = now.getTime();
	return announcements.filter( ( announcement ) => {
		if ( announcement.startsAt && time < Date.parse( announcement.startsAt ) ) {
			return false;
		}
		if ( announcement.endsAt && time >= Date.parse( announcement.endsAt ) ) {
			return false;
		}
		return true;
	} );
}
