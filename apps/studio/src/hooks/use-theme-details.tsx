import React, { createContext, useContext, useMemo, ReactNode, useState, useEffect } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { siteDetailsContext, useSiteDetails } from 'src/hooks/use-site-details';
import { useWindowListener } from 'src/hooks/use-window-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';

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

const ThemeDetailsContext = createContext< ThemeDetailsContextType >( {
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
	const { loadingSites, sites, selectedSite } = useSiteDetails();
	const [ thumbnails, setThumbnails ] = useState< Record< string, ThumbnailType > >( {} );
	const [ themeDetails, setThemeDetails ] = useState< Record< string, ThemeDetailsType > >( {} );
	const [ loadingThemeDetails, setLoadingThemeDetails ] = useState< Record< string, boolean > >(
		{}
	);
	const [ loadingThumbnails, setLoadingThumbnails ] = useState< Record< string, boolean > >( {} );

	useIpcListener( 'theme-details-loading', ( _evt, { id } ) => {
		setLoadingThemeDetails( ( loadingThemeDetails ) => {
			return { ...loadingThemeDetails, [ id ]: true };
		} );
	} );

	useIpcListener( 'theme-details-loaded', ( _evt, { id, details } ) => {
		setThemeDetails( ( themeDetails ) => {
			return { ...themeDetails, [ id ]: details };
		} );
		setLoadingThemeDetails( ( loadingThemeDetails ) => {
			return { ...loadingThemeDetails, [ id ]: false };
		} );
	} );

	useIpcListener( 'thumbnail-loading', ( _evt, { id } ) => {
		setLoadingThumbnails( ( loadingThumbnails ) => {
			return { ...loadingThumbnails, [ id ]: true };
		} );
	} );

	useIpcListener( 'thumbnail-loaded', ( _evt, { id, imageData } ) => {
		setThumbnails( ( thumbnails ) => {
			if ( imageData === thumbnails[ id ] ) {
				return thumbnails;
			}
			return { ...thumbnails, [ id ]: imageData ?? undefined };
		} );
		setLoadingThumbnails( ( loadingThumbnails ) => {
			return { ...loadingThumbnails, [ id ]: false };
		} );
	} );

	useIpcListener( 'thumbnail-load-error', ( _evt, { id } ) => {
		setLoadingThumbnails( ( loadingThumbnails ) => {
			return { ...loadingThumbnails, [ id ]: false };
		} );
	} );

	useWindowListener( 'focus', async () => {
		// When the window is focused, we need to kick off a request to refetch the theme details, if server is running.
		if ( ! selectedSite?.id || selectedSite.running === false ) {
			return;
		}
		await getIpcApi().loadThemeDetails( selectedSite.id, false );
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
					const thumbnailData = await getIpcApi().getThumbnailData( site.id );
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
			void run();
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
