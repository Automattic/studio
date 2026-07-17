import { useSyncExternalStore } from 'react';
import type { SiteDetails } from '@/data/core';

// Dev-only fake-site injection (see components/dev-message-lab): simulates an
// agency-scale site list so sidebar work — scrolling, filtering, grouping —
// can be exercised without creating real sites. Same store shape as
// dev-lab-site-activity.ts: the lab (dev-gated) is the only writer;
// useSites() always reads it, which resolves to an empty list in production.

const COUNT_STORAGE_KEY = 'studio-ui-dev-lab-fake-site-count-v1';
const FAKE_SITE_ID_PREFIX = 'dev-lab-fake-site-';

export const FAKE_SITE_COUNT_OPTIONS = [ 0, 25, 100, 250 ];

const NAME_LEADS = [
	'Harbor',
	'Bluebird',
	'Cedar',
	'Summit',
	'Lighthouse',
	'Maple',
	'Ironwood',
	'Coastal',
	'Prairie',
	'Beacon',
	'Riverstone',
	'Falcon',
	'Juniper',
	'Cobalt',
	'Larkspur',
	'Granite',
	'Willow',
	'Foxglove',
	'Amber',
	'Northgate',
];

const NAME_TRADES = [
	'Dental',
	'Law',
	'Realty',
	'Bakery',
	'Fitness',
	'Roofing',
	'Landscaping',
	'Books',
	'Coffee',
	'Consulting',
	'Photography',
	'Plumbing',
	'Yoga',
	'Auto',
	'Pediatrics',
	'Brewing',
	'Catering',
	'Salon',
	'Marketing',
	'Hardware',
];

function generateFakeSites( count: number ): SiteDetails[] {
	return Array.from( { length: count }, ( _, index ) => {
		const lead = NAME_LEADS[ index % NAME_LEADS.length ];
		const trade = NAME_TRADES[ Math.floor( index / NAME_LEADS.length ) % NAME_TRADES.length ];
		const name = `${ lead } ${ trade }`;
		return {
			id: `${ FAKE_SITE_ID_PREFIX }${ index }`,
			name,
			path: `/dev-lab/fake-sites/${ name.toLowerCase().replace( / /g, '-' ) }-${ index }`,
			port: 0,
			running: index % 9 === 4,
			phpVersion: '8.3',
		};
	} );
}

function readStoredCount(): number {
	if ( ! import.meta.env.DEV ) {
		return 0;
	}
	// Defaults to a simulated 100 sites in dev (the point of the exploration);
	// the Message lab buttons override and persist, including "Off".
	try {
		const stored = window.localStorage.getItem( COUNT_STORAGE_KEY );
		if ( stored === null ) {
			return 100;
		}
		const parsed = Number( stored );
		return Number.isInteger( parsed ) && parsed >= 0 ? parsed : 100;
	} catch {
		return 100;
	}
}

// Module-level snapshot so useSyncExternalStore gets stable references.
let fakeSites: SiteDetails[] = generateFakeSites( readStoredCount() );
const listeners = new Set< () => void >();

function subscribe( listener: () => void ): () => void {
	listeners.add( listener );
	return () => listeners.delete( listener );
}

export function setFakeSiteCount( count: number ): void {
	fakeSites = generateFakeSites( count );
	try {
		window.localStorage.setItem( COUNT_STORAGE_KEY, String( count ) );
	} catch {
		// Lab-only storage; losing it on reload is acceptable.
	}
	for ( const listener of listeners ) {
		listener();
	}
}

export function useFakeSites(): SiteDetails[] {
	return useSyncExternalStore( subscribe, () => fakeSites );
}

export function isFakeSite( siteId: string ): boolean {
	return siteId.startsWith( FAKE_SITE_ID_PREFIX );
}
