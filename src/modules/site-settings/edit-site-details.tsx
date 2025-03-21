import { SelectControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useState } from 'react';
import stripAnsi from 'strip-ansi';
import Button from 'src/components/button';
import { ErrorInformation } from 'src/components/error-information';
import Modal from 'src/components/modal';
import offlineIcon from 'src/components/offline-icon';
import TextControlComponent from 'src/components/text-control';
import { Tooltip } from 'src/components/tooltip';
import { useOffline } from 'src/hooks/use-offline';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';
import { generateCustomDomainFromSiteName, validateDomainName } from 'src/lib/domains';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getWordPressVersionUrl } from 'src/lib/get-wordpress-version-url';
import { useRootSelector } from 'src/stores';
import { wordpressVersionsSelectors } from 'src/stores/wordpress-versions-slice';
import {
	DEFAULT_PHP_VERSION,
	ALLOWED_PHP_VERSIONS,
	AllowedPHPVersion,
} from 'vendor/wp-now/src/constants';
import { addWpVersionToList } from './lib/wordpress-versions';

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
	const [ needsRestart, setNeedsRestart ] = useState( false );
	const isOffline = useOffline();
	const offlineMessage = __( 'Changing WordPress version requires an internet connection.' );
	const closeModal = useCallback( () => {
		if ( isEditingSite ) {
			return;
		}
		setShowModal( false );
	}, [ isEditingSite ] );
	const [ siteName, setSiteName ] = useState( selectedSite?.name ?? '' );
	const [ selectedPhpVersion, setSelectedPhpVersion ] = useState< AllowedPHPVersion >(
		( selectedSite?.phpVersion as AllowedPHPVersion ) ?? DEFAULT_PHP_VERSION
	);
	const [ selectedWpVersion, setSelectedWpVersion ] = useState( currentWpVersion );
	const [ useCustomDomain, setUseCustomDomain ] = useState( Boolean( selectedSite?.customDomain ) );
	const [ customDomain, setCustomDomain ] = useState< string | null >(
		selectedSite?.customDomain ?? null
	);
	const [ customDomainError, setCustomDomainError ] = useState( '' );
	const [ enableHttps, setEnableHttps ] = useState( false );
	const wordpressVersions = useRootSelector(
		wordpressVersionsSelectors.selectWordPressVersionsWithLatest
	);
	const wordpressVersionOptions = wordpressVersions.map( ( version ) => ( {
		label: version.label,
		value: version.value,
	} ) );

	if ( ! wordpressVersionOptions.some( ( version ) => version.value === currentWpVersion ) ) {
		addWpVersionToList( currentWpVersion, wordpressVersionOptions );
	}
	const generatedDomainName = generateCustomDomainFromSiteName( siteName );
	const usedCustomDomain = ! useCustomDomain ? customDomain : undefined;
	const isFormUnchanged =
		!! selectedSite &&
		selectedSite.name === siteName &&
		selectedSite.phpVersion === selectedPhpVersion &&
		currentWpVersion === selectedWpVersion &&
		Boolean( selectedSite.customDomain ) === useCustomDomain &&
		usedCustomDomain === customDomain &&
		!! selectedSite.enableHttps === ( !! usedCustomDomain && enableHttps );
	const hasValidationErrors =
		! selectedSite || ! siteName.trim() || ( useCustomDomain && !! customDomainError );

	const resetFormState = useCallback( () => {
		if ( ! selectedSite ) {
			return;
		}
		setSiteName( selectedSite.name );
		setSelectedPhpVersion( selectedSite.phpVersion as AllowedPHPVersion );
		setSelectedWpVersion( currentWpVersion );
		setUseCustomDomain( Boolean( selectedSite.customDomain ) );
		setCustomDomain( selectedSite.customDomain ?? null );
		setCustomDomainError( '' );
		setIsChangeWpError( '' );
		setEnableHttps( selectedSite.enableHttps ?? false );
	}, [ currentWpVersion, selectedSite ] );

	const onSiteEdit = async ( event: FormEvent ) => {
		event.preventDefault();
		if ( ! selectedSite?.id ) {
			return;
		}
		setIsEditingSite( true );
		setIsChangeWpError( '' );

		const hasWpVersionChanged = selectedWpVersion !== currentWpVersion;
		const hasPhpVersionChanged = selectedPhpVersion !== selectedSite.phpVersion;
		const needsRestart = selectedSite.running && ( hasWpVersionChanged || hasPhpVersionChanged );
		setNeedsRestart( needsRestart );

		try {
			if ( needsRestart ) {
				await stopServer( selectedSite.id );
			}

			if ( hasWpVersionChanged ) {
				try {
					const zipUrl = getWordPressVersionUrl( selectedWpVersion );
					const result = await getIpcApi().executeWPCLiInline( {
						siteId: selectedSite.id,
						args: `core update ${ zipUrl } --force`,
						skipPluginsAndThemes: true,
					} );
					if ( result.exitCode !== 0 ) {
						throw new Error( result.stderr );
					}
				} catch ( wpError ) {
					console.error( 'Error changing WordPress version:', wpError );
					const errorMessage = stripAnsi( ( wpError as Error )?.message );
					setIsChangeWpError( __( 'Error changing WordPress version.' ) );
					getIpcApi().showErrorMessageBox( {
						title: __( 'Error changing WordPress version' ),
						message: errorMessage,
					} );
					setSelectedWpVersion( currentWpVersion );
					setIsEditingSite( false );
					return;
				}
			}

			// Determine custom domain setting
			let usedCustomDomain = useCustomDomain && customDomain ? customDomain : undefined;
			if ( useCustomDomain && ! customDomain ) {
				usedCustomDomain = generateCustomDomainFromSiteName( siteName ?? '' );
			}

			await updateSite( {
				...selectedSite,
				name: siteName,
				phpVersion: selectedPhpVersion,
				customDomain: usedCustomDomain,
				enableHttps: !! usedCustomDomain && enableHttps,
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
		setNeedsRestart( false );
	};

	const getEditSiteButtonText = () => {
		if ( ! isEditingSite ) {
			return __( 'Save' );
		}
		return needsRestart ? __( 'Saving and restarting…' ) : __( 'Saving…' );
	};

	const handleCustomDomainChange = useCallback(
		( value: string | null ) => {
			setCustomDomain( value );
			setCustomDomainError( validateDomainName( useCustomDomain, value ) );
		},
		[ useCustomDomain, setCustomDomain, setCustomDomainError ]
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
					className={ cx(
						isEditingSite &&
							'[&_[aria-label="Close"]_svg]:opacity-50 [&_[aria-label="Close"]]:cursor-not-allowed'
					) }
				>
					<form onSubmit={ onSiteEdit }>
						<div className="flex flex-col">
							<label className="flex flex-col gap-1.5 leading-4 mb-6">
								<span className="font-semibold">{ __( 'Site name' ) }</span>
								<TextControlComponent
									disabled={ isEditingSite }
									onChange={ setSiteName }
									value={ siteName }
								></TextControlComponent>
							</label>

							<div className="flex flex-row gap-x-6">
								<label
									htmlFor="php-version-select"
									className="flex flex-1 flex-col gap-1.5 leading-4"
								>
									<span className="font-semibold">{ __( 'PHP version' ) }</span>
									<SelectControl
										id="php-version-select"
										disabled={ isEditingSite }
										value={ selectedPhpVersion }
										options={ ALLOWED_PHP_VERSIONS.map( ( version ) => ( {
											label: version,
											value: version,
										} ) ) }
										onChange={ ( version: AllowedPHPVersion ) => setSelectedPhpVersion( version ) }
										__next40pxDefaultSize
										__nextHasNoMarginBottom
									/>
								</label>

								<label
									htmlFor="wp-version-select"
									className="flex flex-1 flex-col gap-1.5 leading-4"
								>
									<span className="font-semibold">{ __( 'WordPress version' ) }</span>
									<Tooltip
										disabled={ ! isOffline }
										icon={ offlineIcon }
										text={ offlineMessage }
										placement="top-start"
										className="flex flex-1 flex-col"
									>
										<SelectControl
											id="wp-version-select"
											className={ cx( isChangeWpError && 'error-select-control' ) }
											disabled={ isEditingSite || isOffline }
											value={ selectedWpVersion }
											options={ wordpressVersionOptions }
											onChange={ setSelectedWpVersion }
											__next40pxDefaultSize
											__nextHasNoMarginBottom
										/>
									</Tooltip>
								</label>
							</div>
							{ isChangeWpError && (
								<ErrorInformation className="mt-2">{ isChangeWpError }</ErrorInformation>
							) }

							<div className="flex flex-col gap-2 mt-4">
								<div className="flex items-center gap-2">
									<input
										type="checkbox"
										id="use-custom-domain"
										checked={ useCustomDomain }
										onChange={ ( e ) => setUseCustomDomain( e.target.checked ) }
										disabled={ isEditingSite }
									/>
									<label htmlFor="use-custom-domain">{ __( 'Use custom domain' ) }</label>
								</div>

								{ useCustomDomain && (
									<div className="flex flex-col gap-2 mt-2">
										<label htmlFor="custom-domain" className="font-semibold">
											{ __( 'Domain name' ) }
										</label>
										<TextControlComponent
											id="custom-domain"
											value={ customDomain ?? generatedDomainName }
											onChange={ handleCustomDomainChange }
											disabled={ isEditingSite }
										/>
										{ customDomainError && (
											<ErrorInformation className="mt-1">{ customDomainError }</ErrorInformation>
										) }
										<div className="text-a8c-gray-50 text-xs mt-1">
											{ __( 'Your system password will be required to set up the domain.' ) }
										</div>
									</div>
								) }

								{ useCustomDomain && (
									<div className="flex items-center gap-2 mt-4">
										<input
											type="checkbox"
											id="enable-https"
											checked={ enableHttps }
											onChange={ ( e ) => setEnableHttps( e.target.checked ) }
										/>
										<label htmlFor="enable-https">{ __( 'Enable HTTPS' ) }</label>
									</div>
								) }
							</div>
						</div>

						<div className="flex flex-row justify-end gap-x-5 mt-8">
							<Button onClick={ closeModal } disabled={ isEditingSite } variant="tertiary">
								{ __( 'Cancel' ) }
							</Button>
							<Button
								type="submit"
								variant="primary"
								isBusy={ isEditingSite }
								disabled={ isEditingSite || isFormUnchanged || hasValidationErrors }
							>
								{ getEditSiteButtonText() }
							</Button>
						</div>
					</form>
				</Modal>
			) }
			<Button
				disabled={ ! selectedSite }
				className="shrink-0"
				onClick={ () => {
					setShowModal( true );
					resetFormState();
				} }
				label={ __( 'Edit site' ) }
				variant="secondary"
			>
				{ __( 'Edit site' ) }
			</Button>
		</>
	);
}
