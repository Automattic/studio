import { speak } from '@wordpress/a11y';
import { sprintf } from '@wordpress/i18n';
import { Icon, wordpress } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import Button from 'src/components/button';
import DragAndDropOverlay from 'src/components/drag-and-drop-overlay';
import { SiteForm } from 'src/components/site-form';
import { ACCEPTED_IMPORT_FILE_TYPES } from 'src/constants';
import { useAddSite } from 'src/hooks/use-add-site';
import { useDragAndDropFile } from 'src/hooks/use-drag-and-drop-file';
import { generateSiteName } from 'src/lib/generate-site-name';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch } from 'src/stores';
import { saveOnboardingStatus } from 'src/stores/onboarding-slice';
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

export default function Onboarding() {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
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
		setFileForImport,
		fileForImport,
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
	const [ fileError, setFileError ] = useState( '' );

	const siteAddedMessage = sprintf(
		// translators: %s is the site name.
		__( '%s site added.' ),
		siteName
	);

	const { dropRef, isDraggingOver } = useDragAndDropFile< HTMLDivElement >( {
		onFileDrop: ( file: File ) => {
			const isAccepted = ACCEPTED_IMPORT_FILE_TYPES.some( ( ext ) =>
				file.name.toLowerCase().endsWith( ext )
			);

			if ( isAccepted ) {
				setFileForImport( file );
				setFileError( '' );
			} else {
				setFileError( __( 'Invalid file type. Please select a valid backup file.' ) );
				setFileForImport( null );
			}
		},
	} );

	const { data: versions = [] } = useGetWordPressVersions();
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
			try {
				await getIpcApi().promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );
			} catch ( error ) {
				console.error( error );
			}

			try {
				await handleAddSiteClick();
				// Save onboarding completion after site is successfully created
				await dispatch( saveOnboardingStatus( true ) );
				speak( siteAddedMessage );
			} catch {
				// No need to handle error here, it's already handled in handleAddSiteClick
			}
		},
		[ handleAddSiteClick, siteAddedMessage, dispatch ]
	);

	const handleImportFile = useCallback(
		async ( file: File ) => {
			setFileForImport( file );
			setFileError( '' );
		},
		[ setFileForImport ]
	);

	return (
		<div className="flex flex-row flex-grow" data-testid="onboarding">
			<div className="w-1/2 bg-a8c-blue-50 pb-[50px] pt-[46px] px-[50px] flex flex-col justify-between">
				<div className="flex justify-end fill-white items-center gap-1">
					<Icon size={ 24 } icon={ wordpress } />
				</div>
				<GradientBox />
			</div>

			<div
				className="w-1/2 bg-white p-[50px] flex flex-col relative overflow-y-auto app-no-drag-region"
				ref={ dropRef }
			>
				{ isDraggingOver && <DragAndDropOverlay /> }
				<div className="flex flex-col justify-center items-start flex-[1_0_0%] gap-8">
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
							fileForImport={ fileForImport }
							setFileForImport={ setFileForImport }
							onFileSelected={ handleImportFile }
							fileError={ fileError }
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
							<div className="flex flex-row gap-x-5 mt-6 justify-end">
								<Button type="submit" variant="primary">
									{ __( 'Add site' ) }
								</Button>
							</div>
						</SiteForm>
					</div>
				</div>
			</div>
		</div>
	);
}
