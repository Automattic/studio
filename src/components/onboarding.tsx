import { speak } from '@wordpress/a11y';
import { sprintf } from '@wordpress/i18n';
import { Icon, check, wordpress } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useEffect } from 'react';
import { useAddSite } from '../hooks/use-add-site';
import { useOnboarding } from '../hooks/use-onboarding';
import { isMac } from '../lib/app-globals';
import { generateSiteName } from '../lib/generate-site-name';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import { MacPermissionCard, OtherOsPermissionCard } from './permission-cards';
import { SiteForm } from './site-form';

const GradientBox = () => {
	const { __ } = useI18n();
	const Arrow = () => (
		<svg width="18" height="13" viewBox="0 0 18 13" fill="none">
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M11.8061 12.5L10.6181 11.3121L14.7841 7.14603L0.012085 7.14603L0.0120851 5.46603L14.7841 5.46603L10.6181 1.3L11.8061 0.112061L18 6.30603L11.8061 12.5Z"
				fill="white"
			/>
		</svg>
	);
	return (
		<div
			aria-label={ __( 'Imagine, Create, Design, Code, Build' ) }
			className="gap-1 flex flex-col font-normal text-[42px] leading-[42px] text-white"
		>
			<div className="flex flex-col gap-1 relative self-stretch">
				<div className="absolute inset-0 bg-gradient-to-b from-[#3858E9] to-[#3858E9]/60"></div>
				<p>{ __( 'Imagine' ) }</p>
				<p>{ __( 'Create' ) }</p>
				<p>{ __( 'Design' ) }</p>
				<p>{ __( 'Code' ) }</p>
			</div>
			<div className="text-white tracking-[-0.84px] flex justify-between items-baseline self-stretch">
				<p>{ __( 'Build' ) }</p>
				<Arrow />
			</div>
		</div>
	);
};

const PermissionItem = ( { title, subtitle }: { title: string; subtitle: string } ) => {
	return (
		<div className="flex flex-col">
			<div className="flex items-center gap-1 self-stretch">
				<Icon className="fill-a8c-green-50" size={ 24 } icon={ check } />
				<div className="gap-[10px]">
					<p className="text-xs font-normal text-a8c-gray-70 leading-5">{ title }</p>
				</div>
			</div>
			<div className="pl-7 text-xs flex items-start text-a8c-gray-60 gap-[10px]">
				<p>{ subtitle }</p>
			</div>
		</div>
	);
};

export default function Onboarding() {
	const { __ } = useI18n();
	const { showNextStep, completeOnboarding } = useOnboarding();
	const {
		setSiteName,
		isAddingSite,
		setProposedSitePath,
		setSitePath,
		setError,
		setDoesPathContainWordPress,
		siteName,
		sitePath,
		error,
		doesPathContainWordPress,
		handleAddSiteClick,
		handleSiteNameChange,
		handlePathSelectorClick,
	} = useAddSite();

	const siteAddedMessage = sprintf(
		// translators: %s is the site name.
		__( '%s site added.' ),
		siteName
	);

	useEffect( () => {
		const run = async () => {
			const { path, name, isWordPress } = await getIpcApi().generateProposedSitePath(
				generateSiteName( [] )
			);
			setSiteName( name );
			setProposedSitePath( path );
			setSitePath( '' );
			setError( '' );
			setDoesPathContainWordPress( isWordPress );
		};
		run();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [] );

	const handleSubmit = useCallback(
		async ( event: FormEvent ) => {
			event.preventDefault();
			try {
				await handleAddSiteClick();
				speak( siteAddedMessage );
			} catch {
				// No need to handle error here, it's already handled in handleAddSiteClick
			}
		},
		[ handleAddSiteClick, siteAddedMessage ]
	);

	return (
		<div className="flex flex-row flex-grow">
			{ ! showNextStep && (
				<div className="w-1/2 bg-a8c-blueberry pb-[50px] pt-[46px] px-[50px] flex flex-col justify-between">
					<div className="flex justify-end fill-white items-center gap-1">
						<Icon size={ 24 } icon={ wordpress } />
					</div>
					<GradientBox />
				</div>
			) }
			{ showNextStep && (
				<div className="w-1/2 bg-a8c-blueberry pb-[50px] pt-[46px] px-[50px] flex flex-col">
					<div className="flex justify-end fill-white items-center gap-1">
						<Icon size={ 24 } icon={ wordpress } />
					</div>
					<div className="flex flex-col h-full w-full justify-center gap-[38px] flex-[1_0_0%] items-center">
						{ isMac() && <MacPermissionCard /> }
						{ ! isMac() && <OtherOsPermissionCard /> }
					</div>
				</div>
			) }
			<div className="w-1/2 bg-white p-[50px] flex flex-col app-no-drag-region">
				{ ! showNextStep && (
					<div className="h-[569px] flex flex-col justify-center items-start flex-[1_0_0%] gap-8">
						<div className="flex flex-col items-start self-stretch gap-6">
							<h1 className="font-normal text-xl leading-5">{ __( 'Add your first site' ) }</h1>
							<SiteForm
								className="self-stretch"
								siteName={ siteName || '' }
								setSiteName={ handleSiteNameChange }
								sitePath={ sitePath }
								onSelectPath={ handlePathSelectorClick }
								error={ error }
								doesPathContainWordPress={ doesPathContainWordPress }
								onSubmit={ handleSubmit }
							>
								<div className="flex flex-row gap-x-5 mt-6">
									<Button
										type="submit"
										isBusy={ isAddingSite }
										disabled={ !! error || isAddingSite }
										variant="primary"
									>
										{ isAddingSite ? __( 'Adding site…' ) : __( 'Continue' ) }
									</Button>
								</div>
							</SiteForm>
						</div>
					</div>
				) }
				{ showNextStep && (
					<div className="flex flex-col justify-center items-start flex-[1_0_0%] gap-8">
						<div className="flex flex-col items-start self-stretch gap-2">
							<h1 className="font-normal text-xl leading-5">{ __( 'Permissions needed' ) }</h1>
							<p className="text-a8c-gray-70 text-[13px]">
								{ __( "You'll need to grant Studio access to:" ) }
							</p>
						</div>
						<div className="flex flex-col gap-2">
							<PermissionItem
								title={ __( 'Accept incoming network connections' ) }
								subtitle={ __( 'Allows you to access your sites through a browser' ) }
							/>
						</div>
						<Button
							onClick={ completeOnboarding }
							className="bg-a8c-blueberry hover:text-white text-white"
							variant="primary"
						>
							{ __( 'Continue' ) }
						</Button>
					</div>
				) }
			</div>
		</div>
	);
}
