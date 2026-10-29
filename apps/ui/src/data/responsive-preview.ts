import { useSyncExternalStore } from 'react';

export interface ResponsivePreviewSettings {
	enabled: boolean;
	preset: string;
	width: number;
	height: number;
	zoom: 'fit' | number;
}

const defaultResponsivePreviewSettings: ResponsivePreviewSettings = {
	enabled: false,
	preset: 'responsive',
	width: 400,
	height: 800,
	zoom: 'fit',
};
const settings = new Map< string, ResponsivePreviewSettings >();
const listeners = new Set< () => void >();

const getResponsivePreview = ( siteId: string ) =>
	settings.get( siteId ) ?? defaultResponsivePreviewSettings;

export function updateResponsivePreview(
	siteId: string,
	patch: Partial< ResponsivePreviewSettings >
) {
	settings.set( siteId, { ...getResponsivePreview( siteId ), ...patch } );
	listeners.forEach( ( listener ) => listener() );
}

export function useResponsivePreview( siteId: string ) {
	return useSyncExternalStore(
		( listener ) => {
			listeners.add( listener );
			return () => listeners.delete( listener );
		},
		() => getResponsivePreview( siteId )
	);
}
