import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import { useSiteDetails } from '../hooks/use-site-details';
import Button from './button';
import { SiteForm, SiteModal } from './site-modal';

export default function EditSite() {
	const { __ } = useI18n();
	const { updateSite, selectedSite } = useSiteDetails();
	const [ editSiteError, setEditSiteError ] = useState( '' );
	const [ needsToEditSite, setNeedsToEditSite ] = useState( false );
	const [ isEditingSite, setIsEditingSite ] = useState( false );
	const [ siteName, setSiteName ] = useState( selectedSite?.name ?? '' );
	const [ sitePath, setSitePath ] = useState( selectedSite?.path ?? '' );

	const resetLocalState = useCallback( () => {
		setNeedsToEditSite( false );
		setSiteName( '' );
		setEditSiteError( '' );
	}, [] );

	const onSiteEdit = useCallback( async () => {
		if ( ! selectedSite ) {
			return;
		}
		setIsEditingSite( true );
		try {
			await updateSite( {
				...selectedSite,
				name: siteName,
				path: sitePath,
			} );
			setNeedsToEditSite( false );
			resetLocalState();
		} catch ( e ) {
			setEditSiteError( ( e as Error )?.message );
		}
		setIsEditingSite( false );
	}, [ updateSite, selectedSite, siteName, sitePath, resetLocalState ] );

	return (
		<>
			<SiteModal
				isOpen={ needsToEditSite }
				onRequestClose={ resetLocalState }
				title={ __( 'Edit site' ) }
				primaryButtonLabel={ __( 'Save' ) }
				onPrimaryAction={ onSiteEdit }
				isPrimaryButtonDisabled={ Boolean(
					isEditingSite || ! selectedSite || selectedSite?.name === siteName || editSiteError
				) }
				isCancelDisabled={ isEditingSite }
			>
				<SiteForm
					siteName={ siteName }
					setSiteName={ setSiteName }
					sitePath={ sitePath }
					// eslint-disable-next-line @typescript-eslint/no-empty-function
					onSelectPath={ () => {} }
					isPathInputDisabled={ true }
					error={ editSiteError }
				/>
			</SiteModal>
			<Button
				disabled={ ! selectedSite }
				className="!ml-4"
				onClick={ () => {
					if ( selectedSite ) {
						setSiteName( selectedSite.name );
						setSitePath( selectedSite.path );
					}
					setNeedsToEditSite( true );
				} }
				label={ __( 'Edit site name' ) }
				variant="link"
			>
				{ __( 'Edit' ) }
			</Button>
		</>
	);
}
