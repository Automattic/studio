import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useState } from 'react';
import { useIpcListener } from '../hooks/use-ipc-listener';
import { useSiteDetails } from '../hooks/use-site-details';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import { ModalContent, SiteModal } from './site-modal';

const DEFAULT_SITE_NAME = 'My Site';

interface AddSiteProps {
	className?: string;
}
export default function AddSite( { className }: AddSiteProps ) {
	const { __ } = useI18n();
	const { createSite, data } = useSiteDetails();
	const [ addSiteError, setAddSiteError ] = useState( '' );
	const [ needsToAddSite, setNeedsToAddSite ] = useState( false );
	const [ isAddingSite, setIsAddingSite ] = useState( false );
	const [ siteName, setSiteName ] = useState< string | null >( null );
	const [ sitePath, setSitePath ] = useState( '' );
	const [ proposedSitePath, setProposedSitePath ] = useState( '' );
	const [ doesPathContainWordPress, setDoesPathContainWordPress ] = useState( false );

	const setErrorIfPathExistsForSite = useCallback(
		( path: string ) => {
			const allPaths = data.map( ( site ) => site.path );
			if ( allPaths.includes( path ) ) {
				setAddSiteError( __( 'Another site already exists at this path.' ) );
				return true;
			}
			return false;
		},
		[ __, data ]
	);

	useEffect( () => {
		if ( siteName !== null ) {
			return;
		}
		const setDefaultSiteValues = async () => {
			const path = await getIpcApi().generateProposedSitePath( DEFAULT_SITE_NAME );
			setSiteName( DEFAULT_SITE_NAME );
			setProposedSitePath( path );
			setErrorIfPathExistsForSite( path );
		};
		setDefaultSiteValues();
	}, [ data, setErrorIfPathExistsForSite, siteName, sitePath, proposedSitePath ] );

	const onSelectPath = useCallback( async () => {
		const response = await getIpcApi().showOpenFolderDialog( __( 'Choose folder for site' ) );
		if ( response?.path ) {
			const { path, name, isEmpty: isEmptyPath, isWordPress } = response;
			setDoesPathContainWordPress( false );
			setAddSiteError( '' );
			setSitePath( path );
			const isPathExists = setErrorIfPathExistsForSite( path );
			if ( isPathExists ) {
				return;
			}
			if ( ! isEmptyPath && ! isWordPress ) {
				setAddSiteError( __( 'This path does not contain a WordPress site.' ) );
				return;
			}
			setDoesPathContainWordPress( ! isEmptyPath && isWordPress );
			if ( ! siteName ) {
				setSiteName( name ?? null );
			}
		}
	}, [ __, setErrorIfPathExistsForSite, siteName ] );

	useIpcListener( 'add-site', () => {
		setNeedsToAddSite( true );
	} );

	className = cx(
		'!ring-1 !ring-inset ring-white text-white hover:bg-gray-100 hover:text-black',
		className
	);

	const resetLocalState = useCallback( () => {
		setNeedsToAddSite( false );
		setSiteName( null );
		setSitePath( '' );
		setAddSiteError( '' );
		setProposedSitePath( '' );
		setDoesPathContainWordPress( false );
	}, [] );

	const onSiteAdd = useCallback( async () => {
		setIsAddingSite( true );
		try {
			const path = sitePath ? sitePath : proposedSitePath;
			await createSite( path, siteName ?? '' );
			setNeedsToAddSite( false );
			resetLocalState();
		} catch ( e ) {
			setAddSiteError( ( e as Error )?.message );
		}
		setIsAddingSite( false );
	}, [ createSite, proposedSitePath, resetLocalState, siteName, sitePath ] );

	const onSetSiteName = useCallback(
		async ( name: string ) => {
			setAddSiteError( '' );
			setSiteName( name );
			if ( sitePath ) {
				return;
			}
			const defaultSitePath = await getIpcApi().generateProposedSitePath( name );
			setErrorIfPathExistsForSite( defaultSitePath );
			setProposedSitePath( defaultSitePath );
		},
		[ setErrorIfPathExistsForSite, sitePath ]
	);

	return (
		<>
			<SiteModal
				isOpen={ needsToAddSite }
				onRequestClose={ resetLocalState }
				title={ __( 'Add a Site' ) }
				primaryButtonLabel={ __( 'Add Site' ) }
				onPrimaryAction={ onSiteAdd }
				isPrimaryButtonDisabled={ addSiteError !== '' || ! siteName }
				isCancelDisabled={ isAddingSite }
			>
				<ModalContent
					siteName={ siteName || '' }
					setSiteName={ onSetSiteName }
					sitePath={ sitePath ? sitePath : proposedSitePath }
					onSelectPath={ onSelectPath }
					error={ addSiteError }
					doesPathContainWordPress={ doesPathContainWordPress }
				/>
			</SiteModal>
			<Button className={ className } onClick={ () => setNeedsToAddSite( true ) }>
				{ __( 'Add site' ) }
			</Button>
		</>
	);
}
