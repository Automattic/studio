import { SupportedPHPVersion, SupportedPHPVersions } from '@php-wasm/universal';
import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useState } from 'react';
import stripAnsi from 'strip-ansi';
import Button from 'src/components/button';
import { ErrorInformation } from 'src/components/error-information';
import Modal from 'src/components/modal';
import TextControlComponent from 'src/components/text-control';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useRootSelector } from 'src/stores';
import { wordpressVersionsSelectors } from 'src/stores/wordpress-versions-slice';
import { DEFAULT_PHP_VERSION } from 'vendor/wp-now/src/constants';

type EditSiteDetailsProps = {
	currentWpVersion: string;
	onSave: () => void;
};

export default function EditSiteDetails( { currentWpVersion, onSave }: EditSiteDetailsProps ) {
	const { __ } = useI18n();
	const { updateSite, selectedSite, stopServer, startServer } = useSiteDetails();
	const [ isChangeWpError, setIsChangeWpError ] = useState( '' );
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
	const wordpressVersionOptions = wordpressVersions.map( ( version ) => ( {
		label: version.label,
		value: version.value,
	} ) );
	if ( ! wordpressVersionOptions.some( ( version ) => version.value === currentWpVersion ) ) {
		wordpressVersionOptions.push( { label: currentWpVersion, value: currentWpVersion } );
	}

	const resetFormState = useCallback( () => {
		if ( ! selectedSite ) {
			return;
		}
		setSiteName( selectedSite.name );
		setSelectedPhpVersion( selectedSite.phpVersion as SupportedPHPVersion );
		setSelectedWpVersion( currentWpVersion );
		setIsChangeWpError( '' );
	}, [ currentWpVersion, selectedSite ] );

	const onSiteEdit = async ( event: FormEvent ) => {
		event.preventDefault();
		if ( ! selectedSite?.id ) {
			return;
		}
		setIsEditingSite( true );
		setIsChangeWpError( '' );
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
					const result = await getIpcApi().executeWPCLiInline( {
						siteId: selectedSite.id,
						args: `core update --version=${ selectedWpVersion } --force`,
						skipPluginsAndThemes: true,
					} );
					if ( result.exitCode !== 0 ) {
						throw new Error( result.stderr );
					}
				} catch ( wpError ) {
					console.error( 'Error changing WordPress version:', wpError );
					const errorMessage = stripAnsi( ( wpError as Error )?.message );
					setIsChangeWpError( __( 'Error changing WordPress version' ) );
					getIpcApi().showErrorMessageBox( {
						title: __( 'Error changing WordPress version' ),
						message: errorMessage,
					} );
					setSelectedWpVersion( currentWpVersion );
					setIsEditingSite( false );
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
			onSave();
			closeModal();
			resetFormState();
		} catch ( e ) {
			setIsChangeWpError( ( e as Error )?.message );
		}
		setIsEditingSite( false );
	};

	return (
		<>
			{ showModal && (
				<Modal
					size="medium"
					title={ __( 'Edit site' ) }
					isDismissible
					focusOnMount="firstContentElement"
					onRequestClose={ closeModal }
					className={ cx(
						isEditingSite &&
							'[&_[aria-label="Close"]_svg]:opacity-50 [&_[aria-label="Close"]]:cursor-not-allowed'
					) }
				>
					<form onSubmit={ onSiteEdit }>
						<div className="flex flex-col gap-6">
							<label className="flex flex-col gap-1.5 leading-4">
								<span className="font-semibold">{ __( 'Site name' ) }</span>
								<TextControlComponent
									disabled={ isEditingSite }
									onChange={ setSiteName }
									value={ siteName }
								></TextControlComponent>
							</label>

							<div className="flex flex-row gap-x-6">
								<label className="flex flex-1 flex-col gap-1.5 leading-4">
									<span className="font-semibold">{ __( 'PHP version' ) }</span>
									<SelectControl
										disabled={ isEditingSite }
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
										className={ cx( isChangeWpError && 'error-select-control' ) }
										disabled={ isEditingSite }
										value={ selectedWpVersion }
										options={ wordpressVersionOptions }
										onChange={ setSelectedWpVersion }
										__next40pxDefaultSize
									/>
								</label>
							</div>
						</div>

						{ isChangeWpError && (
							<ErrorInformation className="mt-4">{ isChangeWpError }</ErrorInformation>
						) }

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
										! siteName.trim()
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
					resetFormState();
				} }
				label={ __( 'Edit site' ) }
				variant="link"
			>
				{ __( 'Edit' ) }
			</Button>
		</>
	);
}
