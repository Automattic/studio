import { SupportedPHPVersion, SupportedPHPVersions } from '@php-wasm/universal';
import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import Button from 'src/components/button';
import Modal from 'src/components/modal';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useRootSelector } from 'src/stores';
import { wordpressVersionsSelectors } from 'src/stores/wordpress-versions-slice';
import { DEFAULT_PHP_VERSION } from 'vendor/wp-now/src/constants';

export default function EditSiteDetails() {
	const { __ } = useI18n();
	const { updateSite, selectedSite, stopServer, startServer } = useSiteDetails();
	const [ editSiteError, setEditSiteError ] = useState( '' );
	const [ showModal, setShowModal ] = useState( false );
	const [ isEditingSite, setIsEditingSite ] = useState( false );
	const [ siteName, setSiteName ] = useState( selectedSite?.name ?? '' );
	const [ selectedPhpVersion, setSelectedPhpVersion ] = useState< SupportedPHPVersion >(
		( selectedSite?.phpVersion as SupportedPHPVersion ) ?? DEFAULT_PHP_VERSION
	);
	const [ selectedWpVersion, setSelectedWpVersion ] = useState( 'latest' );

	const wordpressVersions = useRootSelector( wordpressVersionsSelectors.selectWordPressVersions );

	useEffect( () => {
		if ( selectedSite && showModal ) {
			setSiteName( selectedSite.name );
			setSelectedPhpVersion( selectedSite.phpVersion as SupportedPHPVersion );
		}
	}, [ selectedSite, showModal ] );

	const resetLocalState = useCallback( () => {
		setShowModal( false );
		setSiteName( '' );
		setSelectedPhpVersion( DEFAULT_PHP_VERSION );
		setSelectedWpVersion( 'latest' );
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
				const running = selectedSite.running;
				await updateSite( {
					...selectedSite,
					name: siteName,
					phpVersion: selectedPhpVersion,
				} );
				if ( running && selectedSite.phpVersion !== selectedPhpVersion ) {
					await stopServer( selectedSite.id );
					await startServer( selectedSite.id );
				}
				setShowModal( false );
				resetLocalState();
			} catch ( e ) {
				setEditSiteError( ( e as Error )?.message );
			}
			setIsEditingSite( false );
		},
		[
			updateSite,
			selectedSite,
			siteName,
			selectedPhpVersion,
			resetLocalState,
			startServer,
			stopServer,
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
					onRequestClose={ resetLocalState }
				>
					<form onSubmit={ onSiteEdit }>
						<div className="flex flex-col gap-6">
							<label className="flex flex-col gap-1.5 leading-4">
								<span className="font-semibold">{ __( 'Site name' ) }</span>
								<input
									type="text"
									className="components-text-control__input"
									value={ siteName }
									onChange={ ( e ) => setSiteName( e.target.value ) }
								/>
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
										__nextHasNoMarginBottom
									/>
								</label>

								<label className="flex flex-1 flex-col gap-1.5 leading-4">
									<span className="font-semibold">{ __( 'WordPress version' ) }</span>
									<SelectControl
										value={ selectedWpVersion }
										options={ [
											...( wordpressVersions || [] ).map( ( version ) => ( {
												label: version.name,
												value: version.version,
											} ) ),
										] }
										onChange={ ( version ) => setSelectedWpVersion( version ) }
									/>
								</label>
							</div>
						</div>

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
										( selectedSite?.name === siteName &&
											selectedSite?.phpVersion === selectedPhpVersion ) ||
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
