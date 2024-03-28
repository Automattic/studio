import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useState } from 'react';
import { useAddSite } from '../hooks/use-add-site';
import { useIpcListener } from '../hooks/use-ipc-listener';
import { cx } from '../lib/cx';
import { generateSiteName } from '../lib/generate-site-name';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import { SiteForm, SiteModal } from './site-modal';

interface AddSiteProps {
	className?: string;
}
export default function AddSite( { className }: AddSiteProps ) {
	const { __ } = useI18n();
	const [ showModal, setShowModal ] = useState( false );
	const [ nameSuggested, setNameSuggested ] = useState( false );

	const {
		handleAddSiteClick,
		isAddingSite,
		siteName,
		setSiteName,
		setProposedSitePath,
		sitePath,
		setSitePath,
		error,
		setError,
		doesPathContainWordPress,
		setDoesPathContainWordPress,
		handleSiteNameChange,
		handlePathSelectorClick,
		usedSiteNames,
		loadingSites,
	} = useAddSite();

	const initializeForm = useCallback( async () => {
		const { name, path, isWordPress } =
			( await getIpcApi().generateProposedSitePath( generateSiteName( usedSiteNames ) ) ) || {};
		setNameSuggested( true );
		setSiteName( name );
		setProposedSitePath( path );
		setSitePath( '' );
		setError( '' );
		setDoesPathContainWordPress( isWordPress );
	}, [
		usedSiteNames,
		setSiteName,
		setProposedSitePath,
		setSitePath,
		setError,
		setDoesPathContainWordPress,
	] );

	useEffect( () => {
		if ( showModal && ! nameSuggested && ! loadingSites ) {
			initializeForm();
		}
	}, [ nameSuggested, loadingSites, initializeForm ] );

	const openModal = useCallback( async () => {
		setShowModal( true );
	}, [] );

	const closeModal = useCallback( () => {
		setShowModal( false );
	}, [] );

	const onHandleAddSiteClick = useCallback( async () => {
		try {
			await handleAddSiteClick();
			closeModal();
		} catch {
			// No need to handle error here, it's already handled in handleAddSiteClick
		}
	}, [ handleAddSiteClick, closeModal ] );

	useIpcListener( 'add-site', () => {
		openModal();
	} );

	const buttonClassName = cx(
		'!ring-1 !ring-inset ring-white text-white hover:text-black',
		className
	);

	return (
		<>
			<SiteModal
				isOpen={ showModal && ! loadingSites }
				onRequestClose={ closeModal }
				title={ __( 'Add a site' ) }
				primaryButtonLabel={ isAddingSite ? __( 'Adding site…' ) : __( 'Add site' ) }
				onPrimaryAction={ onHandleAddSiteClick }
				isPrimaryButtonDisabled={ !! error || ! siteName }
				isCancelDisabled={ isAddingSite }
				isLoading={ isAddingSite }
			>
				<SiteForm
					siteName={ siteName || '' }
					setSiteName={ handleSiteNameChange }
					sitePath={ sitePath }
					onSelectPath={ handlePathSelectorClick }
					error={ error }
					doesPathContainWordPress={ doesPathContainWordPress }
				/>
			</SiteModal>
			<Button className={ buttonClassName } onClick={ openModal }>
				{ __( 'Add site' ) }
			</Button>
		</>
	);
}
