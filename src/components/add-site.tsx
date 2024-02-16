import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import { useIpcListener } from '../hooks/use-ipc-listener';
import { useSiteDetails } from '../hooks/use-site-details';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import { ModalContent, SiteModal } from './site-modal';

interface AddSiteProps {
	className?: string;
}
export default function AddSite( { className }: AddSiteProps ) {
	const { __ } = useI18n();
	const { createSite, data } = useSiteDetails();
	const [ addSiteError, setAddSiteError ] = useState( '' );
	const [ needsToAddSite, setNeedsToAddSite ] = useState( false );
	const [ isAddingSite, setIsAddingSite ] = useState( false );
	const [ siteName, setSiteName ] = useState( '' );
	const [ sitePath, setSitePath ] = useState( '' );
	const [ doesPathContainWordPress, setDoesPathContainWordPress ] = useState( false );

	const onSelectPath = useCallback( async () => {
		const response = await getIpcApi().showOpenFolderDialog( __( 'Choose folder for site' ) );
		if ( response?.path ) {
			const { path, name, isEmpty: isEmptyPath, isWordPress } = response;
			setDoesPathContainWordPress( false );
			setAddSiteError( '' );
			setSitePath( path );
			const allPaths = data.map( ( site ) => site.path );
			if ( allPaths.includes( path ) ) {
				setAddSiteError( __( 'Another site already exists at this path.' ) );
				return;
			}
			if ( ! isEmptyPath && ! isWordPress ) {
				setAddSiteError( __( 'This path does not contain a WordPress site.' ) );
				return;
			}
			setDoesPathContainWordPress( ! isEmptyPath && isWordPress );
			if ( ! siteName ) {
				setSiteName( name ?? '' );
			}
		}
	}, [ __, data, siteName ] );

	useIpcListener( 'add-site', () => {
		setNeedsToAddSite( true );
	} );

	className = cx(
		'!ring-1 !ring-inset ring-white text-white hover:bg-gray-100 hover:text-black',
		className
	);

	const resetLocalState = useCallback( () => {
		setNeedsToAddSite( false );
		setSiteName( '' );
		setSitePath( '' );
		setAddSiteError( '' );
		setDoesPathContainWordPress( false );
	}, [] );

	const onSiteAdd = useCallback( async () => {
		setIsAddingSite( true );
		try {
			await createSite( sitePath, siteName );
			setNeedsToAddSite( false );
			resetLocalState();
		} catch ( e ) {
			setAddSiteError( ( e as Error )?.message );
		}
		setIsAddingSite( false );
	}, [ createSite, resetLocalState, siteName, sitePath ] );

	return (
		<>
			<SiteModal
				isOpen={ needsToAddSite }
				onRequestClose={ resetLocalState }
				title={ __( 'Add a Site' ) }
				primaryButtonLabel={ __( 'Add Site' ) }
				onPrimaryAction={ onSiteAdd }
				isPrimaryButtonDisabled={ isAddingSite || ! siteName || ! sitePath }
				isCancelDisabled={ isAddingSite }
			>
				<ModalContent
					siteName={ siteName }
					setSiteName={ setSiteName }
					sitePath={ sitePath }
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
