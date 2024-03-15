import { useCallback, useEffect, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useWindowListener } from './use-window-listener';

export function useThemeDetails(
	selectedSite: SiteDetails
): ( SiteDetails[ 'themeDetails' ] & { thumbnailData: string | null } ) | undefined {
	const [ freshThemeDetails, setFreshThemeDetails ] = useState< {
		[ siteId: string ]: SiteDetails[ 'themeDetails' ] & { thumbnailData: string | null };
	} >( {} );

	const getThemeDetails = useCallback( async () => {
		function delayedThumbnailRefresh( delayMS = 2000 ) {
			return setTimeout( async () => {
				const thumbnailData = await getIpcApi()?.getThumbnailData( selectedSite.id );
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
			}, delayMS );
		}

		const newthemeDetails = await getIpcApi()?.getThemeDetails( selectedSite.id );
		const latestThemeDetails =
			newthemeDetails || freshThemeDetails[ selectedSite.id ] || selectedSite.themeDetails;
		let timerDownUpdateThumbnail: NodeJS.Timeout;
		if (
			latestThemeDetails &&
			( latestThemeDetails.path !== freshThemeDetails[ selectedSite.id ]?.path ||
				latestThemeDetails.isBlockTheme !== freshThemeDetails[ selectedSite.id ]?.isBlockTheme )
		) {
			console.log( 'Setting fresh theme details' );
			const thumbnailData = await getIpcApi()?.getThumbnailData( selectedSite.id );
			timerDownUpdateThumbnail = delayedThumbnailRefresh( 2000 );
			setFreshThemeDetails( ( previousState ) => ( {
				...previousState,
				[ selectedSite.id ]: {
					...latestThemeDetails,
					thumbnailData,
				},
			} ) );
			return () => {
				clearTimeout( timerDownUpdateThumbnail );
			};
		}
	}, [ freshThemeDetails, selectedSite ] );

	useEffect( () => {
		getThemeDetails();
	}, [ getThemeDetails ] );

	useWindowListener( 'focus', getThemeDetails );

	return freshThemeDetails[ selectedSite.id ];
}
