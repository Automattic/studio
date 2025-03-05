import { SupportedPHPVersion, SupportedPHPVersions } from '@php-wasm/universal';
import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import Button from 'src/components/button';
import Modal from 'src/components/modal';
import TextControlComponent from 'src/components/text-control';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useRootSelector } from 'src/stores';
import { wordpressVersionsSelectors } from 'src/stores/wordpress-versions-slice';
import { DEFAULT_PHP_VERSION } from 'vendor/wp-now/src/constants';

export default function EditSiteDetails( { currentWpVersion }: { currentWpVersion: string } ) {
	const { __ } = useI18n();
	const { updateSite, selectedSite, stopServer, startServer } = useSiteDetails();
	const [ editSiteError, setEditSiteError ] = useState( '' );
	const [ showModal, setShowModal ] = useState( false );
	const [ isEditingSite, setIsEditingSite ] = useState( false );
	const closeModal = useCallback( () => {
		if ( isEditingSite ) {
			return;
		}
		setShowModal( false );
	}, [ isEditingSite ] );
	const [ siteName, setSiteName ] = useState( selectedSite?.name ?? '' );
	const [ selectedPhpVersion, setSelectedPhpVersion ] = useState< SupportedPHPVersion >(
		( selectedSite?.phpVersion as SupportedPHPVersion ) ?? DEFAULT_PHP_VERSION
	);
	const [ selectedWpVersion, setSelectedWpVersion ] = useState( currentWpVersion );
	const wordpressVersions = useRootSelector( wordpressVersionsSelectors.selectWordPressVersions );

	const resetLocalState = useCallback( () => {
		if ( ! selectedSite ) {
			return;
		}

		setSiteName( selectedSite.name );
		setSelectedPhpVersion( selectedSite.phpVersion as SupportedPHPVersion );
		setSelectedWpVersion( currentWpVersion );
		setEditSiteError( '' );
	}, [ currentWpVersion, selectedSite ] );

	useEffect( () => {
		if ( showModal ) {
			resetLocalState();
		}
	}, [ showModal, resetLocalState ] );

	const onSiteEdit = useCallback(
		async ( event: FormEvent ) => {
			event.preventDefault();
			if ( ! selectedSite?.id ) {
				return;
			}
			setIsEditingSite( true );
			try {
				const running = selectedSite.running;

				const hasWpVersionChanged = selectedWpVersion !== currentWpVersion;
				const hasPhpVersionChanged = selectedPhpVersion !== selectedSite.phpVersion;
				const needsRestart = running && ( hasWpVersionChanged || hasPhpVersionChanged );
				if ( needsRestart ) {
					await stopServer( selectedSite.id );
				}

				if ( hasWpVersionChanged ) {
					try {
						await getIpcApi().executeWPCLiInline( {
							siteId: selectedSite.id,
							args: `core update --version=${ selectedWpVersion } --force`,
							skipPluginsAndThemes: false,
						} );
					} catch ( wpError ) {
						console.error( 'Error updating WordPress version:', wpError );
						setEditSiteError( ( wpError as Error )?.message );
						getIpcApi().showErrorMessageBox( {
							title: __( 'Error updating WordPress version' ),
							message: ( wpError as Error )?.message,
						} );
						return;
					}
				}

				await updateSite( {
					...selectedSite,
					name: siteName,
					phpVersion: selectedPhpVersion,
				} );

				if ( needsRestart ) {
					await startServer( selectedSite.id );
				}

				closeModal();
				resetLocalState();
			} catch ( e ) {
				setEditSiteError( ( e as Error )?.message );
			}
			setIsEditingSite( false );
		},
		[
			selectedSite,
			selectedWpVersion,
			currentWpVersion,
			selectedPhpVersion,
			updateSite,
			siteName,
			closeModal,
			resetLocalState,
			stopServer,
			__,
			startServer,
		]
	);

	return (
		<>
			{ showModal && (
				<Modal
					size="medium"
					title={ __( 'Edit site' ) }
					isDismissible
					focusOnMount="firstContentElement"
					onRequestClose={ closeModal }
				>
					<form onSubmit={ onSiteEdit }>
						<div className="flex flex-col gap-6">
							<label className="flex flex-col gap-1.5 leading-4">
								<span className="font-semibold">{ __( 'Site name' ) }</span>
								<TextControlComponent
									onChange={ setSiteName }
									value={ siteName }
								></TextControlComponent>
							</label>

							<div className="flex flex-row gap-x-6">
								<label className="flex flex-1 flex-col gap-1.5 leading-4">
									<span className="font-semibold">{ __( 'PHP version' ) }</span>
									<SelectControl
										value={ selectedPhpVersion }
										options={ SupportedPHPVersions.map( ( version ) => ( {
											label: version,
											value: version,
										} ) ) }
										onChange={ ( version ) => setSelectedPhpVersion( version ) }
										__next40pxDefaultSize
									/>
								</label>

								<label className="flex flex-1 flex-col gap-1.5 leading-4">
									<span className="font-semibold">{ __( 'WordPress version' ) }</span>
									<SelectControl
										value={ selectedWpVersion }
										options={ wordpressVersions.map( ( { label, value } ) => ( {
											label,
											value,
										} ) ) }
										onChange={ setSelectedWpVersion }
										__next40pxDefaultSize
									/>
								</label>
							</div>
						</div>

						<div className="flex flex-row justify-end gap-x-5 mt-6">
							<Button onClick={ closeModal } disabled={ isEditingSite } variant="tertiary">
								{ __( 'Cancel' ) }
							</Button>
							<Button
								type="submit"
								variant="primary"
								isBusy={ isEditingSite }
								disabled={ Boolean(
									isEditingSite ||
										! selectedSite ||
										( selectedSite?.name === siteName &&
											selectedSite?.phpVersion === selectedPhpVersion &&
											currentWpVersion === selectedWpVersion ) ||
										! siteName.trim() ||
										editSiteError
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
					setShowModal( true );
				} }
				label={ __( 'Edit site' ) }
				variant="link"
			>
				{ __( 'Edit' ) }
			</Button>
		</>
	);
}
