import { useSyncExternalStore } from 'react';

export interface ResponsivePreviewSettings {
	enabled: boolean;
	preset: string;
	width: number;
	height: number;
	zoom: 'fit' | number;
	fitScale?: number;
}

const defaultResponsivePreviewSettings: ResponsivePreviewSettings = {
	enabled: false,
	preset: 'responsive',
	width: 400,
	height: 800,
	zoom: 'fit',
};
const settings = new Map< string, Map< string, ResponsivePreviewSettings > >();
const listeners = new Set< () => void >();

const defaultTabId = ( siteId: string ) => `${ siteId }:local:initial`;

const getResponsivePreview = ( siteId: string, tabId = defaultTabId( siteId ) ) =>
	settings.get( siteId )?.get( tabId ) ?? defaultResponsivePreviewSettings;

export function updateResponsivePreview(
	siteId: string,
	patch: Partial< ResponsivePreviewSettings >,
	tabId = defaultTabId( siteId )
) {
	const current = getResponsivePreview( siteId, tabId );
	const refit =
		patch.enabled === true ||
		patch.zoom === 'fit' ||
		patch.width !== undefined ||
		patch.height !== undefined ||
		patch.preset !== undefined;
	let tabs = settings.get( siteId );
	if ( ! tabs ) {
		tabs = new Map();
		settings.set( siteId, tabs );
	}
	tabs.set( tabId, { ...current, ...( refit ? { fitScale: undefined } : {} ), ...patch } );
	listeners.forEach( ( listener ) => listener() );
}

export function resetResponsivePreview( siteId: string ) {
	const tabs = settings.get( siteId );
	if ( ! tabs ) return;
	let changed = false;
	for ( const [ id, current ] of tabs ) {
		if ( ! current.enabled && current.fitScale === undefined ) continue;
		tabs.set( id, { ...current, enabled: false, fitScale: undefined } );
		changed = true;
	}
	if ( changed ) listeners.forEach( ( listener ) => listener() );
}

export function removeResponsivePreview( siteId: string, tabId?: string ) {
	if ( tabId ) {
		const tabs = settings.get( siteId );
		if ( ! tabs?.delete( tabId ) ) return;
		if ( ! tabs.size ) settings.delete( siteId );
	} else if ( ! settings.delete( siteId ) ) return;
	listeners.forEach( ( listener ) => listener() );
}

export function useResponsivePreview( siteId: string, tabId = defaultTabId( siteId ) ) {
	return useSyncExternalStore(
		( listener ) => {
			listeners.add( listener );
			return () => listeners.delete( listener );
		},
		() => getResponsivePreview( siteId, tabId )
	);
}
