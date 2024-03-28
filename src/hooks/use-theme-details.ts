import { useCallback, useEffect, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useWindowListener } from './use-window-listener';

interface UseThemeDetails {
	loading: boolean;
	details: ( SiteDetails[ 'themeDetails' ] & { thumbnailData: string | null } ) | undefined;
}
export function useThemeDetails( selectedSite: SiteDetails ): UseThemeDetails {
	const [ loading, setLoading ] = useState< { [ siteId: string ]: boolean } >( {
		[ selectedSite.id ]: true,
	} );
	const [ freshThemeDetails, setFreshThemeDetails ] = useState< {
		[ siteId: string ]: SiteDetails[ 'themeDetails' ] & { thumbnailData: string | null };
	} >( {} );

	const getThemeDetails = useCallback( async () => {
		function delayedThumbnailRefresh( delayMS = 2000 ) {
			return setTimeout( async () => {
				const thumbnailData = await getIpcApi()?.getThumbnailData?.( selectedSite.id );
				if (
					thumbnailData &&
					thumbnailData !== freshThemeDetails[ selectedSite.id ]?.thumbnailData
				) {
					setFreshThemeDetails( ( previousState ) => ( {
						...previousState,
						[ selectedSite.id ]: {
							...latestThemeDetails,
							thumbnailData,
						},
					} ) );
				}
				setLoading( ( loadingState ) => ( { ...loadingState, [ selectedSite.id ]: false } ) );
			}, delayMS );
		}
		setLoading( ( loadingState ) => {
			if ( loadingState[ selectedSite.id ] === undefined ) {
				return { ...loadingState, [ selectedSite.id ]: true };
			}
			return loadingState;
		} );

		const newthemeDetails = await getIpcApi()?.getThemeDetails?.( selectedSite.id );
		const latestThemeDetails =
			newthemeDetails || freshThemeDetails[ selectedSite.id ] || selectedSite.themeDetails;
		let timerDownUpdateThumbnail: NodeJS.Timeout;
		if (
			latestThemeDetails &&
			( latestThemeDetails.path !== freshThemeDetails[ selectedSite.id ]?.path ||
				latestThemeDetails.isBlockTheme !== freshThemeDetails[ selectedSite.id ]?.isBlockTheme )
		) {
			console.log( 'Setting fresh theme details' );
			const thumbnailData = await getIpcApi()?.getThumbnailData?.( selectedSite.id );
			timerDownUpdateThumbnail = delayedThumbnailRefresh( 2000 );
			setFreshThemeDetails( ( previousState ) => ( {
				...previousState,
				[ selectedSite.id ]: {
					...latestThemeDetails,
					thumbnailData,
				},
			} ) );
			if ( thumbnailData ) {
				setLoading( ( loadingState ) => ( { ...loadingState, [ selectedSite.id ]: false } ) );
			}
			return () => {
				clearTimeout( timerDownUpdateThumbnail );
			};
		}
	}, [ freshThemeDetails, selectedSite ] );

	useEffect( () => {
		getThemeDetails();
	}, [ getThemeDetails ] );

	useWindowListener( 'focus', getThemeDetails );

	return {
		details: freshThemeDetails[ selectedSite.id ],
		loading: loading[ selectedSite.id ],
	};
}
