import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useState } from 'react';
import { useSiteDetails } from '../hooks/use-site-details';
import Button from './button';
import Modal from './modal';
import { SiteForm } from './site-form';

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

	const onSiteEdit = useCallback(
		async ( event: FormEvent ) => {
			event.preventDefault();
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
		},
		[ updateSite, selectedSite, siteName, sitePath, resetLocalState ]
	);

	return (
		<>
			{ needsToEditSite && (
				<Modal
					className="w-[460px]"
					title={ __( 'Edit site' ) }
					isDismissible
					focusOnMount="firstContentElement"
					onRequestClose={ resetLocalState }
				>
					<SiteForm
						siteName={ siteName }
						setSiteName={ setSiteName }
						sitePath={ sitePath }
						// eslint-disable-next-line @typescript-eslint/no-empty-function
						onSelectPath={ () => {} }
						isPathInputDisabled={ true }
						error={ editSiteError }
						onSubmit={ onSiteEdit }
					>
						<div className="flex flex-row justify-end gap-x-5 mt-6">
							<Button onClick={ resetLocalState } disabled={ isEditingSite } variant="tertiary">
								{ __( 'Cancel' ) }
							</Button>
							<Button
								type="submit"
								variant="primary"
								isBusy={ isEditingSite }
								disabled={ Boolean(
									isEditingSite ||
										! selectedSite ||
										selectedSite?.name === siteName ||
										editSiteError
								) }
							>
								{ isEditingSite ? __( 'Saving…' ) : __( 'Save' ) }
							</Button>
						</div>
					</SiteForm>
				</Modal>
			) }
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
