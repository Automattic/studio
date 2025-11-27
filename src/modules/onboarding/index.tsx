import { speak } from '@wordpress/a11y';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import Button from 'src/components/button';
import { SiteForm } from 'src/components/site-form';
import { StudioLogo } from 'src/components/studio-logo';
import { useAddSite } from 'src/hooks/use-add-site';
import { useAuth } from 'src/hooks/use-auth';
import { generateSiteName } from 'src/lib/generate-site-name';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { OnboardingConnectToWpcom } from 'src/modules/onboarding/components/connect-to-wpcom';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { useSaveLastSeenVersionMutation } from 'src/stores/app-version-api';
import { saveOnboardingStatus } from 'src/stores/onboarding-slice';
import { selectMinimumWordPressVersion } from 'src/stores/provider-constants-slice';
import { useGetWordPressVersions } from 'src/stores/wordpress-versions-api';

const GradientBox = () => {
	const { __ } = useI18n();
	return (
		<div
			aria-label={ __( 'Imagine, Create, Design, Code, Build' ) }
			className="gap-0 flex flex-col font-normal text-[42px] leading-[42px] text-white"
		>
			<div className="flex flex-col gap-1 relative self-stretch pb-1">
				<div className="absolute inset-0 bg-gradient-to-b from-[#3858E9] to-[#3858E9]/60"></div>
				<p>{ __( 'Imagine' ) }</p>
				<p>{ __( 'Create' ) }</p>
				<p>{ __( 'Design' ) }</p>
				<p>{ __( 'Code' ) }</p>
			</div>
			<div className="text-white tracking-[-0.84px] flex justify-between items-baseline self-stretch">
				<p>{ __( 'Build' ) }</p>
			</div>
		</div>
	);
};

export function Onboarding() {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const { isAuthenticated } = useAuth();
	const [ saveLastSeenVersion ] = useSaveLastSeenVersionMutation();
	const {
		setSiteName,
		setProposedSitePath,
		setSitePath,
		setError,
		setDoesPathContainWordPress,
		setPhpVersion,
		setWpVersion,
		siteName,
		sitePath,
		error,
		doesPathContainWordPress,
		handleAddSiteClick,
		handleSiteNameChange,
		handlePathSelectorClick,
		phpVersion,
		wpVersion,
		useCustomDomain,
		setUseCustomDomain,
		customDomain,
		setCustomDomain,
		customDomainError,
		setCustomDomainError,
		enableHttps,
		setEnableHttps,
		loadAllCustomDomains,
	} = useAddSite();

	const siteAddedMessage = sprintf(
		// translators: %s is the site name.
		__( '%s site added.' ),
		siteName || ''
	);

	const minimumWordPressVersion = useRootSelector( selectMinimumWordPressVersion );
	const { data: versions = [] } = useGetWordPressVersions( {
		minimumVersion: minimumWordPressVersion,
	} );
	const latestStableVersion = versions.find( ( version ) => version.value === 'latest' );

	useEffect( () => {
		if ( latestStableVersion ) {
			setWpVersion( latestStableVersion.value );
		}
	}, [ latestStableVersion, setWpVersion ] );

	useEffect( () => {
		const run = async () => {
			const siteName = await generateSiteName( [] );
			const { path, name, isWordPress } = await getIpcApi().generateProposedSitePath( siteName );
			setSiteName( name );
			setProposedSitePath( path );
			setSitePath( '' );
			setError( '' );
			setDoesPathContainWordPress( isWordPress );
			setUseCustomDomain( false );
			setCustomDomain( null );
			setCustomDomainError( '' );
			setEnableHttps( false );
			loadAllCustomDomains();
		};
		void run();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [] );

	const handleSubmit = useCallback(
		async ( event: FormEvent ) => {
			event.preventDefault();
			// Save current app version to prevent What's New from showing for new users
			await saveLastSeenVersion( window.appGlobals.appVersion );

			try {
				await handleAddSiteClick();
				// Save onboarding completion after site is successfully created
				await dispatch( saveOnboardingStatus( true ) );
				speak( siteAddedMessage );
			} catch {
				// No need to handle error here, it's already handled in handleAddSiteClick
			}
		},
		[ handleAddSiteClick, siteAddedMessage, dispatch, saveLastSeenVersion ]
	);

	const handleSkip = useCallback( async () => {
		// Save current app version to prevent What's New from showing for new users
		await saveLastSeenVersion( window.appGlobals.appVersion );

		await dispatch( saveOnboardingStatus( true ) );
	}, [ dispatch, saveLastSeenVersion ] );

	return (
		<div className="flex flex-row flex-grow" data-testid="onboarding">
			<div className="w-1/2 bg-a8c-blue-50 pb-[50px] pt-[46px] px-[50px] flex flex-col justify-between">
				<div className="flex justify-start items-center gap-1 mt-6">
					<StudioLogo className="fill-white" />
				</div>
				<GradientBox />
			</div>

			<div className="w-1/2 bg-white py-[50px] px-[20px] flex flex-col relative overflow-y-auto app-no-drag-region">
				<div className="flex flex-col justify-center items-center flex-[1_0_0%] gap-8">
					<OnboardingConnectToWpcom onSkip={ handleSkip } />
					{/* <div className="flex flex-col items-center self-stretch gap-6">
						<div className="flex flex-col items-center gap-4">
							<h1 className="font-normal text-3xl leading-5">{ __( 'Add your first site' ) }</h1>
							<p className="text-a8c-gray-50 text-sm px-10 text-center">
								{ __( "Add your first site and explore Studio's powerful workflow and features." ) }
							</p>
						</div>
						<SiteForm
							className="self-stretch"
							siteName={ siteName || '' }
							setSiteName={ handleSiteNameChange }
							sitePath={ sitePath }
							onSelectPath={ handlePathSelectorClick }
							error={ error }
							doesPathContainWordPress={ doesPathContainWordPress }
							onSubmit={ handleSubmit }
							phpVersion={ phpVersion }
							setPhpVersion={ setPhpVersion }
							wpVersion={ wpVersion }
							setWpVersion={ setWpVersion }
							useCustomDomain={ useCustomDomain }
							setUseCustomDomain={ setUseCustomDomain }
							customDomain={ customDomain }
							setCustomDomain={ setCustomDomain }
							customDomainError={ customDomainError }
							enableHttps={ enableHttps }
							setEnableHttps={ setEnableHttps }
						>
							<div className="flex flex-row mt-6 justify-center">
								<Button type="submit" variant="primary" className="w-full">
									{ __( 'Continue' ) }
								</Button>
							</div>
						</SiteForm>
					</div> */}
				</div>
			</div>
		</div>
	);
}
