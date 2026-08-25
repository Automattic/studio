/**
 * TEMPORARY prototype scaffolding for the sidebar-grouping exploration.
 *
 * Groups are a pure presentation layer over sites: a named, collapsible
 * bucket of site ids rendered as an accordion section in the sidebar. They
 * live in localStorage, same as the plugin tags (see plugin-prototype.ts).
 * Delete this module when real project grouping lands.
 */

import { useSyncExternalStore } from 'react';

export interface SiteGroup {
	id: string;
	name: string;
	siteIds: string[];
	collapsed: boolean;
}

const GROUPS_STORAGE_KEY = 'studio-ui-prototype-site-groups-v1';

function readGroups(): SiteGroup[] {
	try {
		const stored = window.localStorage.getItem( GROUPS_STORAGE_KEY );
		const parsed = stored ? JSON.parse( stored ) : [];
		return Array.isArray( parsed ) ? parsed : [];
	} catch {
		return [];
	}
}

// Module-level snapshot so useSyncExternalStore gets stable references.
let groups: SiteGroup[] = readGroups();
const listeners = new Set< () => void >();

function subscribe( listener: () => void ): () => void {
	listeners.add( listener );
	return () => listeners.delete( listener );
}

function commit( nextGroups: SiteGroup[] ): void {
	groups = nextGroups;
	try {
		window.localStorage.setItem( GROUPS_STORAGE_KEY, JSON.stringify( groups ) );
	} catch {
		// Prototype-only storage; losing it on reload is acceptable.
	}
	for ( const listener of listeners ) {
		listener();
	}
}

/**
 * Creates a group from the given sites. A site belongs to at most one group,
 * so the members are pulled out of any existing groups; groups left empty
 * are dropped.
 */
export function createSiteGroup( name: string, siteIds: string[] ): void {
	const memberIds = new Set( siteIds );
	const remaining = groups
		.map( ( group ) => ( {
			...group,
			siteIds: group.siteIds.filter( ( siteId ) => ! memberIds.has( siteId ) ),
		} ) )
		.filter( ( group ) => group.siteIds.length > 0 );
	commit( [
		...remaining,
		{ id: crypto.randomUUID(), name, siteIds: [ ...siteIds ], collapsed: false },
	] );
}

export function toggleSiteGroupCollapsed( groupId: string ): void {
	commit(
		groups.map( ( group ) =>
			group.id === groupId ? { ...group, collapsed: ! group.collapsed } : group
		)
	);
}

/** Dissolves the group; its sites return to the ungrouped list. */
export function removeSiteGroup( groupId: string ): void {
	commit( groups.filter( ( group ) => group.id !== groupId ) );
}

export function useSiteGroups(): SiteGroup[] {
	return useSyncExternalStore( subscribe, () => groups );
}
