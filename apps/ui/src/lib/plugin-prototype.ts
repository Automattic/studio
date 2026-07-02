/**
 * TEMPORARY prototype scaffolding for the plugin-development exploration
 * (see docs/design-docs/plugin-development-prototype.md).
 *
 * Plugins are just sites with extra presentation: the plugin flows create a
 * real local site, then tag it here so the sidebar can render it as a
 * plugin (glyph, grouping). Tags live in localStorage. Delete this module
 * when real plugin projects land.
 */

import { useSyncExternalStore } from 'react';

export interface PluginSiteTag {
	siteId: string;
	slug: string;
	source: 'new' | 'folder' | 'wporg';
	/** The folder picked in the "Add an existing plugin" flow. */
	path?: string;
}

const TAGS_STORAGE_KEY = 'studio-ui-prototype-plugin-site-tags-v1';

function readTags(): PluginSiteTag[] {
	try {
		const stored = window.localStorage.getItem( TAGS_STORAGE_KEY );
		const parsed = stored ? JSON.parse( stored ) : [];
		return Array.isArray( parsed ) ? parsed : [];
	} catch {
		return [];
	}
}

// Module-level snapshot so useSyncExternalStore gets stable references.
let tags: PluginSiteTag[] = readTags();
const listeners = new Set< () => void >();

function emit() {
	for ( const listener of listeners ) {
		listener();
	}
}

function subscribe( listener: () => void ): () => void {
	listeners.add( listener );
	return () => listeners.delete( listener );
}

function persistTags() {
	try {
		window.localStorage.setItem( TAGS_STORAGE_KEY, JSON.stringify( tags ) );
	} catch {
		// Prototype-only storage; losing it on reload is acceptable.
	}
}

export function tagSiteAsPlugin( tag: PluginSiteTag ): void {
	tags = [ ...tags.filter( ( existing ) => existing.siteId !== tag.siteId ), tag ];
	persistTags();
	emit();
}

/** Untags a single site (e.g. after the site is deleted). */
export function removePluginSiteTag( siteId: string ): void {
	tags = tags.filter( ( tag ) => tag.siteId !== siteId );
	persistTags();
	emit();
}

export function usePluginSiteTags(): PluginSiteTag[] {
	return useSyncExternalStore( subscribe, () => tags );
}

/** The plugin tag for a site, or undefined when the site is a plain site. */
export function usePluginSiteTag( siteId: string | undefined ): PluginSiteTag | undefined {
	const allTags = usePluginSiteTags();
	return siteId ? allTags.find( ( tag ) => tag.siteId === siteId ) : undefined;
}
