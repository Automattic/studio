import { SelectControl } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { generateCustomDomainFromSiteName, getDomainNameValidationError } from '@studio/common/lib/domains';
import { siteNeedsRestart } from '@studio/common/lib/site-needs-restart';
import { SupportedPHPVersions } from '@studio/common/types/php-versions';
import Button from 'src/components/button';
import { ErrorInformation } from 'src/components/error-information';
import { LearnMoreLink, LearnHowLink } from 'src/components/learn-more';
import Modal from 'src/components/modal';
import TextControlComponent from 'src/components/text-control';
import { Tooltip } from 'src/components/tooltip';
import { WPVersionSelector } from 'src/components/wp-version-selector';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useRootSelector } from 'src/stores';
import { useCheckCertificateTrustQuery } from 'src/stores/certificate-trust-api';
import { selectDefaultWordPressVersion } from 'src/stores/provider-constants-slice';
import type { AllowedPHPVersion } from 'src/lib/wordpress-server-types';

type EditSiteDetailsProps = {
	currentWpVersion: string;
	onSave: () => void;
};

const EditSiteDetails = ( { currentWpVersion, onSave }: EditSiteDetailsProps ) => {
	const { __ } = useI18n();
	const { updateSite, selectedSite, isEditModalOpen, setIsEditModalOpen } = useSiteDetails();
	const defaultWordPressVersion = useRootSelector( selectDefaultWordPressVersion );
	const [ errorUpdatingWpVersion, setErrorUpdatingWpVersion ] = useState< string | null >( null );
	const [ isEditingSite, setIsEditingSite ] = useState( false );
	const [ needsRestart, setNeedsRestart ] = useState( false );
	const [ enableXdebug, setEnableXdebug ] = useState( selectedSite?.enableXdebug ?? false );
	const [ xdebugEnabledSite, setXdebugEnabledSite ] = useState< SiteDetails | null >( null );

	const { data: isCertificateTrusted } = useCheckCertificateTrustQuery();
	const closeModal = useCallback( () => {
		if ( isEditingSite ) {
			return;
		}
		setIsEditModalOpen( false );
	}, [ isEditingSite, setIsEditModalOpen ] );
	const [ siteName, setSiteName ] = useState( selectedSite?.name ?? '' );
	const [ selectedPhpVersion, setSelectedPhpVersion ] = useState< AllowedPHPVersion >(
		( selectedSite?.phpVersion as AllowedPHPVersion ) ?? DEFAULT_PHP_VERSION
	);
	const getEffectiveWpVersion = useCallback(
		() =>
			// undefined means that this site was created before the isWpAutoUpdating option was introduced to Studio
			[ undefined, true ].includes( selectedSite?.isWpAutoUpdating )
				? defaultWordPressVersion
				: currentWpVersion,
		[ selectedSite, currentWpVersion, defaultWordPressVersion ]
	);
	const [ selectedWpVersion, setSelectedWpVersion ] = useState( getEffectiveWpVersion() );
	const [ useCustomDomain, setUseCustomDomain ] = useState( Boolean( selectedSite?.customDomain ) );
	const [ customDomain, setCustomDomain ] = useState< string | null >(
		selectedSite?.customDomain ?? null
	);
	const [ customDomainError, setCustomDomainError ] = useState( '' );
	const [ existingDomainNames, setExistingDomainNames ] = useState< string[] >( [] );
	const [ enableHttps, setEnableHttps ] = useState( false );

	useEffect( () => {
		getIpcApi()
			.getAllCustomDomains()
			.then( ( domains ) => {
				const domainsWithoutSelectedSite = domains.filter(
					( domain ) => domain !== selectedSite?.customDomain
				);
				setExistingDomainNames( domainsWithoutSelectedSite );
			} )
			.catch( () => {
				// Do nothing
			} );
	}, [ selectedSite?.customDomain ] );

	useEffect( () => {
		getIpcApi()
			.getXdebugEnabledSite()
			.then( setXdebugEnabledSite )
			.catch( () => {
				// Do nothing
			} );
	}, [ selectedSite ] );

	const generatedDomainName = generateCustomDomainFromSiteName( siteName );
	const usedCustomDomain = ! useCustomDomain ? customDomain : undefined;
	const isFormUnchanged =
		!! selectedSite &&
		selectedSite.name === siteName &&
		selectedSite.phpVersion === selectedPhpVersion &&
		getEffectiveWpVersion() === selectedWpVersion &&
		Boolean( selectedSite.customDomain ) === useCustomDomain &&
		usedCustomDomain === customDomain &&
		!! selectedSite.enableHttps === ( !! usedCustomDomain && enableHttps ) &&
		!! selectedSite.enableXdebug === enableXdebug;
	const hasValidationErrors =
		! selectedSite || ! siteName.trim() || ( useCustomDomain && !! customDomainError );

	const resetFormState = useCallback( () => {
		if ( ! selectedSite ) {
			return;
		}
		setSiteName( selectedSite.name );
		setSelectedPhpVersion( selectedSite.phpVersion as AllowedPHPVersion );
		setSelectedWpVersion( getEffectiveWpVersion() );
		setUseCustomDomain( Boolean( selectedSite.customDomain ) );
		setCustomDomain( selectedSite.customDomain ?? null );
		setCustomDomainError( '' );
		setErrorUpdatingWpVersion( null );
		setEnableHttps( selectedSite.enableHttps ?? false );
		setEnableXdebug( selectedSite.enableXdebug ?? false );
	}, [ selectedSite, getEffectiveWpVersion ] );

	const onSiteEdit = async ( event: FormEvent ) => {
		event.preventDefault();
		if ( ! selectedSite?.id ) {
			return;
		}
		setIsEditingSite( true );
		setErrorUpdatingWpVersion( null );

		const hasWpVersionChanged = selectedWpVersion !== getEffectiveWpVersion();
		const hasPhpVersionChanged = selectedPhpVersion !== selectedSite.phpVersion;
		const hasXdebugChanged = enableXdebug !== ( selectedSite.enableXdebug ?? false );
		const hasDomainChanged =
			Boolean( selectedSite.customDomain ) !== useCustomDomain ||
			( useCustomDomain && customDomain !== selectedSite.customDomain );
		const hasHttpsChanged =
			useCustomDomain && enableHttps !== ( selectedSite.enableHttps ?? false );

		const needsRestart =
			selectedSite.running &&
			siteNeedsRestart( {
				domainChanged: hasDomainChanged,
				httpsChanged: hasHttpsChanged,
				phpChanged: hasPhpVersionChanged,
				wpChanged: hasWpVersionChanged,
				xdebugChanged: hasXdebugChanged,
			} );
		setNeedsRestart( needsRestart );

		try {
			// Determine custom domain setting
			let usedCustomDomain = useCustomDomain && customDomain ? customDomain : undefined;
			if ( useCustomDomain && ! customDomain ) {
				usedCustomDomain = generateCustomDomainFromSiteName( siteName ?? '' );
			}

			await updateSite(
				{
					...selectedSite,
					name: siteName,
					phpVersion: selectedPhpVersion,
					isWpAutoUpdating: selectedWpVersion === defaultWordPressVersion,
					customDomain: usedCustomDomain,
					enableHttps: !! usedCustomDomain && enableHttps,
					enableXdebug,
				},
				hasWpVersionChanged ? selectedWpVersion : undefined
			);

			onSave();
			closeModal();
			resetFormState();
		} catch ( e ) {
			setErrorUpdatingWpVersion( ( e as Error )?.message );
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
			setCustomDomainError(
				getDomainNameValidationError( useCustomDomain, value, existingDomainNames )
			);
		},
		[ useCustomDomain, setCustomDomain, setCustomDomainError, existingDomainNames ]
	);

	return (
		<>
			{ isEditModalOpen && (
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
									<SelectControl< string >
										id="php-version-select"
										disabled={ isEditingSite }
										value={ selectedPhpVersion }
										options={ SupportedPHPVersions.map( ( version ) => ( {
											label: version,
											value: version,
										} ) ) }
										onChange={ ( version ) =>
											setSelectedPhpVersion( version as AllowedPHPVersion )
										}
										__next40pxDefaultSize
										__nextHasNoMarginBottom
									/>
								</label>

								<WPVersionSelector
									selectedValue={ selectedWpVersion }
									onChange={ setSelectedWpVersion }
									disabled={ isEditingSite }
									errorMessage={ errorUpdatingWpVersion }
									extraOptions={ [ { label: currentWpVersion, value: currentWpVersion } ] }
									fallbackOptions={ [ { label: currentWpVersion, value: currentWpVersion } ] }
								/>
							</div>
							{ errorUpdatingWpVersion && (
								<ErrorInformation className="mt-2">{ errorUpdatingWpVersion }</ErrorInformation>
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
											disabled={ isEditingSite }
										/>
										<label htmlFor="enable-https">{ __( 'Enable HTTPS' ) }</label>
									</div>
								) }

								{ ! isCertificateTrusted && useCustomDomain && (
									<div className="text-a8c-gray-50 text-xs mt-2">
										{ __(
											'You need to manually add the Studio certificate authority to your keychain and trust it.'
										) }{ ' ' }
										<LearnHowLink docsLinksKey="docsSslInStudio" />
									</div>
								) }
							</div>

							<div
								className={ cx(
									'flex flex-col gap-2 mt-4',
									isEditingSite ||
										( xdebugEnabledSite && xdebugEnabledSite.id !== selectedSite?.id )
										? 'opacity-50 cursor-not-allowed'
										: ''
								) }
							>
								<Tooltip
									disabled={ ! xdebugEnabledSite || xdebugEnabledSite.id === selectedSite?.id }
									text={ sprintf(
										__(
											'Xdebug is currently enabled for "%s" site. Disable it there first to enable it for this site.'
										),
										xdebugEnabledSite?.name || ''
									) }
									placement="top-start"
								>
									<div>
										<div className="flex items-center gap-2">
											<input
												type="checkbox"
												id="enable-xdebug"
												checked={ enableXdebug }
												onChange={ ( e ) => setEnableXdebug( e.target.checked ) }
												disabled={
													isEditingSite ||
													!! ( xdebugEnabledSite && xdebugEnabledSite.id !== selectedSite?.id )
												}
											/>
											<label
												htmlFor="enable-xdebug"
												className={ cx(
													isEditingSite ||
														( xdebugEnabledSite && xdebugEnabledSite.id !== selectedSite?.id )
														? 'cursor-not-allowed'
														: ''
												) }
											>
												{ __( 'Enable Xdebug' ) }
											</label>
										</div>
										<div className="text-a8c-gray-50 text-xs mt-2">
											{ createInterpolateElement(
												__(
													'Enable PHP debugging with Xdebug. Only one site can have Xdebug enabled at a time. Note that Xdebug may slow down site performance. <learn_more_link />'
												),
												{
													learn_more_link: <LearnMoreLink docsLinksKey="docsXdebug" />,
												}
											) }
										</div>
									</div>
								</Tooltip>
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
						<div className="components-popover__fallback-container"></div>
					</form>
				</Modal>
			) }
			<Button
				disabled={ ! selectedSite }
				className="shrink-0"
				onClick={ () => {
					setIsEditModalOpen( true );
					resetFormState();
				} }
				label={ __( 'Edit site' ) }
				variant="secondary"
			>
				{ __( 'Edit site' ) }
			</Button>
		</>
	);
};
EditSiteDetails.displayName = 'EditSiteDetails';

export default EditSiteDetails;
