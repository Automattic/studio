import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import Button from 'src/components/button';
import Modal from 'src/components/modal';
import { useAddSite } from 'src/hooks/use-add-site';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useImportExport } from 'src/hooks/use-import-export';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import AddSiteLegacy from './add-site-legacy';
import AddSiteOptions from './add-site-options';

interface AddSiteProps {
	className?: string;
}

export default function AddSite( { className }: AddSiteProps ) {
	const { __ } = useI18n();
	const { enableBlueprints } = useFeatureFlags();
	const [ showModal, setShowModal ] = useState( false );

	const { importState } = useImportExport();
	const { sites } = useAddSite();

	const isAnySiteProcessing = sites.some(
		( site ) => site.isAddingSite || importState[ site.id ]?.isNewSite
	);

	const openModal = useCallback( () => {
		setShowModal( true );
	}, [] );

	const closeModal = useCallback( () => {
		setShowModal( false );
	}, [] );

	const handleOptionSelect = useCallback( () => {
		// All options are disabled for now
	}, [] );

	useIpcListener( 'add-site', () => {
		if ( isAnySiteProcessing ) {
			return;
		}
		openModal();
	} );

	// If blueprints is disabled, use the existing component
	if ( ! enableBlueprints ) {
		return (
			<AddSiteLegacy
				className={ className }
				showModal={ showModal }
				setShowModal={ setShowModal }
			/>
		);
	}

	// If blueprints is enabled, show modal with options
	return (
		<>
			{ showModal && (
				<Modal isFullScreen focusOnMount="firstContentElement" onRequestClose={ closeModal }>
					<AddSiteOptions onOptionSelect={ handleOptionSelect } />
				</Modal>
			) }
			<Button
				variant="outlined"
				className={ className }
				onClick={ openModal }
				disabled={ isAnySiteProcessing }
			>
				{ __( 'Add site' ) }
			</Button>
		</>
	);
}
