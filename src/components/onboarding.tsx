import { speak } from '@wordpress/a11y';
import { sprintf } from '@wordpress/i18n';
import { Icon, wordpress, download } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAddSite } from '../hooks/use-add-site';
import { useDragAndDropFile } from '../hooks/use-drag-and-drop-file';
import { generateSiteName } from '../lib/generate-site-name';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import { SiteForm } from './site-form';

const acceptedFileTypes = [
	'application/zip',
	'application/x-gzip',
	'application/sql',
	'application/x-tar',
];

const GradientBox = () => {
	const { __ } = useI18n();
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
			</div>
		</div>
	);
};

export default function Onboarding() {
	const { __ } = useI18n();
	const {
		setSiteName,
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
		setFileForImport,
		fileForImport,
	} = useAddSite();
	const [ fileError, setFileError ] = useState( '' );

	const siteAddedMessage = sprintf(
		// translators: %s is the site name.
		__( '%s site added.' ),
		siteName
	);

	const { dropRef, isDraggingOver } = useDragAndDropFile< HTMLDivElement >( {
		onFileDrop: ( file: File ) => {
			if ( acceptedFileTypes.includes( file.type ) ) {
				setFileForImport( file );
				setFileError( '' );
			} else {
				setFileError( __( 'Invalid file type. Please select a valid backup file.' ) );
				setFileForImport( null );
			}
		},
	} );

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

			// Prompt the user to enable optimizations on Windows
			try {
				await getIpcApi().promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );
			} catch ( error ) {
				console.error( error );
			}

			try {
				await handleAddSiteClick();
				speak( siteAddedMessage );
			} catch {
				// No need to handle error here, it's already handled in handleAddSiteClick
			}
		},
		[ handleAddSiteClick, siteAddedMessage ]
	);

	const handleImportFile = useCallback(
		async ( file: File ) => {
			setFileForImport( file );
		},
		[ setFileForImport ]
	);

	return (
		<div className="flex flex-row flex-grow" data-testid="onboarding">
			<div className="w-1/2 bg-a8c-blueberry pb-[50px] pt-[46px] px-[50px] flex flex-col justify-between">
				<div className="flex justify-end fill-white items-center gap-1">
					<Icon size={ 24 } icon={ wordpress } />
				</div>
				<GradientBox />
			</div>

			<div className="w-1/2 bg-white p-[50px] flex flex-col relative" ref={ dropRef }>
				{ isDraggingOver && (
					<div className="absolute inset-0 bg-white bg-opacity-80 z-10 backdrop-blur-sm flex flex-col items-center justify-center">
						<Icon width={ 32 } height={ 34 } icon={ download } className="fill-a8c-blueberry" />
						<span className="text-[13px] leading-[16px] text-black mt-4">
							{ __( 'Drop backup to import' ) }
						</span>
					</div>
				) }
				<div className="h-[569px] flex flex-col justify-center items-start flex-[1_0_0%] gap-8">
					<div className="flex flex-col items-start self-stretch gap-6 app-no-drag-region">
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
						>
							<div className="flex flex-row gap-x-5 mt-6">
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
