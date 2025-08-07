import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import Button from 'src/components/button';
import { FullscreenModal } from 'src/components/fullscreen-modal';
import { useAddSite } from 'src/hooks/use-add-site';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useImportExport } from 'src/hooks/use-import-export';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import AddSiteLegacy from './components/add-site-legacy';
import AddSiteOptions from './components/add-site-options';

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

	if ( true || ! enableBlueprints ) {
		return (
			<AddSiteLegacy
				className={ className }
				showModal={ showModal }
				setShowModal={ setShowModal }
			/>
		);
	}

	return (
		<>
			<FullscreenModal isOpen={ showModal } onClose={ closeModal }>
				<AddSiteOptions onOptionSelect={ handleOptionSelect } />
			</FullscreenModal>
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
