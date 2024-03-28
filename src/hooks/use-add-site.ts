import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useMemo, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useSiteDetails } from './use-site-details';

export function useAddSite() {
	const { __ } = useI18n();
	const { createSite, data: sites, loadingSites } = useSiteDetails();
	const [ error, setError ] = useState( '' );
	const [ isAddingSite, setIsAddingSite ] = useState( false );
	const [ siteName, setSiteName ] = useState< string | null >( null );
	const [ sitePath, setSitePath ] = useState( '' );
	const [ proposedSitePath, setProposedSitePath ] = useState( '' );
	const [ doesPathContainWordPress, setDoesPathContainWordPress ] = useState( false );

	const usedSiteNames = sites.map( ( site ) => site.name );

	const siteWithPathAlreadyExists = useCallback(
		( path: string ) => {
			return sites.some( ( site ) => site.path === path );
		},
		[ sites ]
	);

	const handlePathSelectorClick = useCallback( async () => {
		const response = await getIpcApi().showOpenFolderDialog( __( 'Choose folder for site' ) );
		if ( response?.path ) {
			const { path, name, isEmpty, isWordPress } = response;
			setDoesPathContainWordPress( false );
			setError( '' );
			setSitePath( path );
			if ( siteWithPathAlreadyExists( path ) ) {
				return;
			}
			if ( ! isEmpty && ! isWordPress ) {
				setError(
					__(
						'This directory is not empty. Please select an empty directory or an existing WordPress folder.'
					)
				);
				return;
			}
			setDoesPathContainWordPress( ! isEmpty && isWordPress );
			if ( ! siteName ) {
				setSiteName( name ?? null );
			}
		}
	}, [ __, siteWithPathAlreadyExists, siteName ] );

	const handleAddSiteClick = useCallback( async () => {
		setIsAddingSite( true );
		try {
			const path = sitePath ? sitePath : proposedSitePath;
			await createSite( path, siteName ?? '' );
		} catch ( e ) {
			setError( ( e as Error )?.message );
			throw e;
		}
		setIsAddingSite( false );
	}, [ createSite, proposedSitePath, siteName, sitePath ] );

	const handleSiteNameChange = useCallback(
		async ( name: string ) => {
			setSiteName( name );
			if ( sitePath ) {
				return;
			}
			setError( '' );
			const {
				path: proposedPath,
				isEmpty,
				isWordPress,
			} = await getIpcApi().generateProposedSitePath( name );
			setProposedSitePath( proposedPath );

			if ( siteWithPathAlreadyExists( proposedPath ) ) {
				return;
			}
			if ( ! isEmpty && ! isWordPress ) {
				setError(
					__(
						'This directory is not empty. Please select an empty directory or an existing WordPress folder.'
					)
				);
				return;
			}
			setDoesPathContainWordPress( ! isEmpty && isWordPress );
		},
		[ __, sitePath, siteWithPathAlreadyExists ]
	);

	return useMemo(
		() => ( {
			handleAddSiteClick,
			handlePathSelectorClick,
			handleSiteNameChange,
			isAddingSite,
			error: siteWithPathAlreadyExists( sitePath ? sitePath : proposedSitePath )
				? __(
						'Another site already exists at this path. Please select an empty directory to create a site.'
				  )
				: error,
			sitePath: sitePath ? sitePath : proposedSitePath,
			siteName,
			doesPathContainWordPress,
			siteWithPathAlreadyExists,
			setSiteName,
			proposedSitePath,
			setProposedSitePath,
			setSitePath,
			setError,
			setDoesPathContainWordPress,
			usedSiteNames,
			loadingSites,
		} ),
		[
			__,
			doesPathContainWordPress,
			error,
			handleAddSiteClick,
			handlePathSelectorClick,
			siteWithPathAlreadyExists,
			handleSiteNameChange,
			isAddingSite,
			siteName,
			sitePath,
			proposedSitePath,
			usedSiteNames,
			loadingSites,
		]
	);
}
