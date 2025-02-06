import { SupportedPHPVersions } from '@php-wasm/universal';
import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import Button from 'src/components/button';
import Modal from 'src/components/modal';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { DEFAULT_PHP_VERSION } from 'vendor/wp-now/src/constants';

export default function EditPhpVersion() {
	const { __ } = useI18n();
	const { updateSite, selectedSite, stopServer, startServer } = useSiteDetails();
	const [ editPhpVersionError, setEditPhpVersionError ] = useState( '' );
	const [ selectedPhpVersion, setSelectedPhpVersion ] = useState( DEFAULT_PHP_VERSION );
	const [ needsToEditPhpVersion, setNeedsToEditPhpVersion ] = useState( false );
	const [ isEditingSite, setIsEditingSite ] = useState( false );

	useEffect( () => {
		if ( selectedSite ) {
			setSelectedPhpVersion( selectedSite.phpVersion );
		}
	}, [ selectedSite ] );

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
				const running = selectedSite.running;
				await updateSite( {
					...selectedSite,
					phpVersion: selectedPhpVersion,
				} );
				if ( running ) {
					await stopServer( selectedSite.id );
					await startServer( selectedSite.id );
				}
				setNeedsToEditPhpVersion( false );
				resetLocalState();
			} catch ( e ) {
				setEditPhpVersionError( ( e as Error )?.message );
			}
			setIsEditingSite( false );
		},
		[ updateSite, selectedSite, selectedPhpVersion, resetLocalState, startServer, stopServer ]
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
								options={ SupportedPHPVersions.map( ( version ) => ( {
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
								{ isEditingSite ? __( 'Restarting server…' ) : __( 'Save' ) }
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
