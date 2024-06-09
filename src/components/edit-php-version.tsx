import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useState } from 'react';
import { useSiteDetails } from '../hooks/use-site-details';
import Button from './button';
import Modal from './modal';

export default function EditPhpVersion() {
	const { __ } = useI18n();
	const { updateSite, selectedSite } = useSiteDetails();
	const [ editPhpVersionError, setEditPhpVersionError ] = useState( '' );
	const [ selectedPhpVersion, setSelectedPhpVersion ] = useState(
		selectedSite?.phpVersion ?? '8.0'
	);
	const [ needsToEditPhpVersion, setNeedsToEditPhpVersion ] = useState( false );
	const [ isEditingSite, setIsEditingSite ] = useState( false );

	const availablePhpVersions = [ '7.4', '8.0', '8.1', '8.2' ];

	const resetLocalState = useCallback( () => {
		setNeedsToEditPhpVersion( false );
		setSelectedPhpVersion( '' );
		setEditPhpVersionError( '' );
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
					phpVersion: selectedPhpVersion,
				} );
				setNeedsToEditPhpVersion( false );
				resetLocalState();
			} catch ( e ) {
				setEditPhpVersionError( ( e as Error )?.message );
			}
			setIsEditingSite( false );
		},
		[ updateSite, selectedSite, selectedPhpVersion, resetLocalState ]
	);

	return (
		<>
			{ needsToEditPhpVersion && (
				<Modal
					size="medium"
					title={ __( 'Edit PHP version' ) }
					isDismissible
					focusOnMount="firstContentElement"
					onRequestClose={ resetLocalState }
				>
					<form onSubmit={ onSiteEdit }>
						<label className="flex flex-col gap-1.5 leading-4">
							<span className="font-semibold">{ __( 'PHP version' ) }</span>
							<SelectControl
								value={ selectedPhpVersion }
								options={ availablePhpVersions.map( ( version ) => ( {
									label: version,
									value: version,
								} ) ) }
								onChange={ ( version ) => setSelectedPhpVersion( version ) }
							/>
						</label>
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
										selectedSite?.phpVersion === selectedPhpVersion ||
										editPhpVersionError
								) }
							>
								{ isEditingSite ? __( 'Saving…' ) : __( 'Save' ) }
							</Button>
						</div>
					</form>
				</Modal>
			) }
			<Button
				disabled={ ! selectedSite }
				className="!mx-4 shrink-0"
				onClick={ () => {
					if ( selectedSite ) {
						setSelectedPhpVersion( selectedSite.phpVersion );
					}
					setNeedsToEditPhpVersion( true );
				} }
				label={ __( 'Edit PHP version' ) }
				variant="link"
			>
				{ __( 'Edit' ) }
			</Button>
		</>
	);
}
