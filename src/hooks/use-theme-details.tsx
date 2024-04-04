import React, { createContext, useContext, useMemo, ReactNode, useState, useEffect } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useIpcListener } from './use-ipc-listener';
import { siteDetailsContext, useSiteDetails } from './use-site-details';
import { useWindowListener } from './use-window-listener';

type ThemeDetailsType = SiteDetails[ 'themeDetails' ] | undefined;
type ThumbnailType = string | undefined;

interface ThemeDetailsContextType {
	loadingThemeDetails: Record< string, boolean >;
	loadingThumbnails: Record< string, boolean >;
	themeDetails: Record< string, ThemeDetailsType >;
	thumbnails: Record< string, ThumbnailType >;
	initialLoading: boolean;
	selectedThemeDetails: ThemeDetailsType;
	selectedThumbnail: ThumbnailType;
	selectedLoadingThemeDetails: boolean;
	selectedLoadingThumbnails: boolean;
}

export const ThemeDetailsContext = createContext< ThemeDetailsContextType >( {
	loadingThemeDetails: {},
	loadingThumbnails: {},
	themeDetails: {},
	thumbnails: {},
	initialLoading: false,
	selectedThemeDetails: undefined,
	selectedThumbnail: undefined,
	selectedLoadingThemeDetails: false,
	selectedLoadingThumbnails: false,
} );

interface ThemeDetailsProviderProps {
	children: ReactNode;
}

export const ThemeDetailsProvider: React.FC< ThemeDetailsProviderProps > = ( { children } ) => {
	const [ initialLoad, setInitialLoad ] = useState( false );
	const { loadingSites, data: sites, selectedSite } = useSiteDetails();
	const [ thumbnails, setThumbnails ] = useState< Record< string, ThumbnailType > >( {} );
	const [ themeDetails, setThemeDetails ] = useState< Record< string, ThemeDetailsType > >( {} );
	const [ loadingThemeDetails, setLoadingThemeDetails ] = useState< Record< string, boolean > >(
		{}
	);
	const [ loadingThumbnails, setLoadingThumbnails ] = useState< Record< string, boolean > >( {} );

	useIpcListener( 'theme-details-changed', ( _evt, id, details ) => {
		setThemeDetails( ( themeDetails ) => {
			return { ...themeDetails, [ id ]: details };
		} );
		setLoadingThemeDetails( ( loadingThemeDetails ) => {
			return { ...loadingThemeDetails, [ id ]: false };
		} );
	} );

	useIpcListener( 'thumbnail-changed', ( _evt, id, imageData ) => {
		setThumbnails( ( thumbnails ) => {
			return { ...thumbnails, [ id ]: imageData };
		} );
		setLoadingThumbnails( ( loadingThumbnails ) => {
			return { ...loadingThumbnails, [ id ]: false };
		} );
	} );

	useIpcListener( 'theme-details-updating', ( _evt, id ) => {
		setLoadingThemeDetails( ( loadingThemeDetails ) => {
			return { ...loadingThemeDetails, [ id ]: true };
		} );
		setLoadingThumbnails( ( loadingThumbnails ) => {
			return { ...loadingThumbnails, [ id ]: true };
		} );
	} );

	useWindowListener( 'focus', async () => {
		// When the window is focused, we need to kick off a request to refetch the theme details, if server is running.
		if ( ! selectedSite?.id || selectedSite.running === false ) {
			return;
		}
		await getIpcApi()?.getThemeDetails?.( selectedSite.id );
	} );

	useEffect( () => {
		let isCurrent = true;
		// Initial load. Prefetch all the thumbnails for the sites.
		const run = async () => {
			const newThemeDetails = { ...themeDetails };
			const newThumbnailData = { ...thumbnails };
			for ( const site of sites ) {
				if ( site.themeDetails ) {
					newThemeDetails[ site.id ] = { ...site.themeDetails };
					const thumbnailData = await getIpcApi()?.getThumbnailData?.( site.id );
					newThumbnailData[ site.id ] = thumbnailData ?? undefined;
				}
			}
			if ( isCurrent ) {
				setInitialLoad( true );
				setThemeDetails( newThemeDetails );
				setThumbnails( newThumbnailData );
			}
		};
		if ( sites.length > 0 && ! loadingSites && ! initialLoad && isCurrent ) {
			run();
		}
		return () => {
			isCurrent = false;
		};
	}, [ initialLoad, loadingSites, sites, themeDetails, thumbnails ] );

	const contextValue = useMemo( () => {
		return {
			thumbnails,
			themeDetails,
			loadingThemeDetails,
			loadingThumbnails,
			initialLoading: ! initialLoad,
			selectedThemeDetails: themeDetails[ selectedSite?.id ?? '' ],
			selectedThumbnail: thumbnails[ selectedSite?.id ?? '' ],
			selectedLoadingThemeDetails: loadingThemeDetails[ selectedSite?.id ?? '' ],
			selectedLoadingThumbnails: loadingThumbnails[ selectedSite?.id ?? '' ],
		};
	}, [
		initialLoad,
		loadingThemeDetails,
		loadingThumbnails,
		selectedSite?.id,
		themeDetails,
		thumbnails,
	] );

	return (
		<ThemeDetailsContext.Provider value={ contextValue }>{ children }</ThemeDetailsContext.Provider>
	);
};

export const useThemeDetails = (): ThemeDetailsContextType => {
	const context = useContext( ThemeDetailsContext );
	const siteDetailsCtx = useContext( siteDetailsContext );

	if ( ! siteDetailsCtx ) {
		throw new Error( 'useThemeDetails must be used within a SiteDetailsProvider' );
	}

	if ( ! context ) {
		throw new Error( 'useThemeDetails must be used within an ThemeDetailsProvider' );
	}

	return context;
};
