import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
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
	} = useAddSite();

	const openModal = useCallback( async () => {
		const { path, name, isWordPress } = await getIpcApi().generateProposedSitePath(
			generateSiteName( usedSiteNames )
		);
		setSiteName( name );
		setProposedSitePath( path );
		setSitePath( '' );
		setError( '' );
		setDoesPathContainWordPress( isWordPress );

		setShowModal( true );
	}, [
		setDoesPathContainWordPress,
		setError,
		setProposedSitePath,
		setSiteName,
		setSitePath,
		usedSiteNames,
	] );

	const closeModal = useCallback( () => {
		setShowModal( false );
	}, [] );

	const onHandleAddSiteClick = useCallback( async () => {
		try {
			await handleAddSiteClick();
			setShowModal( false );
		} catch {
			// No need to handle error here, it's already handled in handleAddSiteClick
		}
	}, [ handleAddSiteClick ] );

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
				isOpen={ showModal }
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
