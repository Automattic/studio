import { ACCEPTED_IMPORT_FILE_TYPES } from '@studio/common/constants';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { arrowLeft, download } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CreateSiteForm } from '@/components/create-site-form';
import { useConnector } from '@/data/core';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import { useImportSite } from '@/data/queries/use-import-site';
import { useCreateSite } from '@/data/queries/use-sites';
import { onboardingLayoutRoute } from '../layout-onboarding';
import sharedStyles from '../layout-onboarding/style.module.css';
import styles from './style.module.css';
import type { CreateSiteFormValues } from '@/components/create-site-form';

type Step = 'select' | 'configure';

interface ImportSearch {
	step?: Step;
}

interface PickedBackup {
	file: File;
	// Resolved from the connector once at pick-time so the submit handler
	// doesn't have to await the preload bridge again.
	path: string;
}

function isValidBackupFile( file: File ): boolean {
	return ACCEPTED_IMPORT_FILE_TYPES.some( ( ext: string ) =>
		file.name.toLowerCase().endsWith( ext )
	);
}

function formatFileSize( bytes: number ): string {
	if ( bytes === 0 ) return '0 Bytes';
	const k = 1024;
	const sizes = [ 'Bytes', 'KB', 'MB', 'GB' ];
	const i = Math.floor( Math.log( bytes ) / Math.log( k ) );
	return Math.round( ( bytes / Math.pow( k, i ) ) * 100 ) / 100 + ' ' + sizes[ i ];
}

function truncateMiddle( filename: string, maxLength = 30 ): string {
	if ( filename.length <= maxLength ) return filename;
	const ellipsis = '\u2026';
	const charsToShow = maxLength - ellipsis.length;
	const frontChars = Math.ceil( charsToShow / 2 );
	const backChars = Math.floor( charsToShow / 2 );
	return (
		filename.substring( 0, frontChars ) +
		ellipsis +
		filename.substring( filename.length - backChars )
	);
}

/**
 * Derives a friendly default site name from a backup filename. Strips the
 * archive extension and common "site-backup-2024-01-01" date suffixes so the
 * form can seed the site name without the user having to retype it.
 */
function nameFromFilename( filename: string ): string {
	let name = filename.replace( /^.*[\\/]/, '' );
	for ( const ext of ACCEPTED_IMPORT_FILE_TYPES as string[] ) {
		if ( name.toLowerCase().endsWith( ext ) ) {
			name = name.slice( 0, -ext.length );
			break;
		}
	}
	name = name.replace( /[-_](backup|export|wordpress|jetpack)(s)?$/i, '' );
	name = name.replace( /[-_]\d{4}[-_]\d{2}[-_]\d{2}.*$/, '' );
	return name.replace( /[-_]+/g, ' ' ).trim();
}

interface BackupDropzoneProps {
	selectedFile: File | null;
	onPick: ( file: File ) => void;
	onClear: () => void;
}

function BackupDropzone( { selectedFile, onPick, onClear }: BackupDropzoneProps ) {
	const fileInputRef = useRef< HTMLInputElement | null >( null );
	const [ isDraggingOver, setIsDraggingOver ] = useState( false );
	const [ uploadError, setUploadError ] = useState< string | null >( null );

	const handleFile = useCallback(
		( file: File ) => {
			if ( ! isValidBackupFile( file ) ) {
				setUploadError(
					__(
						'This file type is not supported. Please use a .zip, .gz, .tar, .tar.gz, or .wpress file.'
					)
				);
				return;
			}
			setUploadError( null );
			onPick( file );
		},
		[ onPick ]
	);

	const handleFileInputChange = ( event: React.ChangeEvent< HTMLInputElement > ) => {
		const file = event.target.files?.[ 0 ];
		if ( file ) handleFile( file );
		// Reset so re-picking the same file after an error re-fires `change`.
		event.target.value = '';
	};

	const handleDrop = ( event: React.DragEvent< HTMLDivElement > ) => {
		event.preventDefault();
		setIsDraggingOver( false );
		const file = event.dataTransfer.files[ 0 ];
		if ( file ) handleFile( file );
	};

	const handleDragOver = ( event: React.DragEvent< HTMLDivElement > ) => {
		event.preventDefault();
		if ( ! isDraggingOver ) setIsDraggingOver( true );
	};

	const handleDragLeave = () => setIsDraggingOver( false );

	return (
		<section className={ styles.section }>
			<div
				className={ `${ styles.dropzone } ${ isDraggingOver ? styles.dropzoneActive : '' }` }
				onDragOver={ handleDragOver }
				onDragLeave={ handleDragLeave }
				onDrop={ handleDrop }
			>
				<Icon icon={ download } />
				{ selectedFile ? (
					<>
						<p className={ styles.fileName } title={ selectedFile.name }>
							{ truncateMiddle( selectedFile.name ) }
						</p>
						<div className={ styles.fileMeta }>
							<span>{ formatFileSize( selectedFile.size ) }</span>
							<Button
								type="button"
								variant="minimal"
								tone="neutral"
								size="small"
								onClick={ onClear }
							>
								{ __( 'Remove' ) }
							</Button>
						</div>
					</>
				) : (
					<>
						<p className={ styles.dropzoneText }>{ __( 'Drop a backup archive here, or' ) }</p>
						<Button
							type="button"
							variant="outline"
							tone="neutral"
							onClick={ () => fileInputRef.current?.click() }
						>
							{ __( 'Choose file…' ) }
						</Button>
					</>
				) }
				<input
					ref={ fileInputRef }
					type="file"
					accept={ ACCEPTED_IMPORT_FILE_TYPES.join( ',' ) }
					className={ styles.fileInput }
					onChange={ handleFileInputChange }
					aria-label={ __( 'Select backup file' ) }
				/>
			</div>
			{ uploadError && <p className={ styles.uploadError }>{ uploadError }</p> }
		</section>
	);
}

function OnboardingImportPage() {
	const { step } = onboardingImportRoute.useSearch();
	const navigate = useNavigate();
	const connector = useConnector();
	const activeStep: Step = step === 'configure' ? 'configure' : 'select';

	const { data: existingDomainNames } = useExistingCustomDomains();
	const createSite = useCreateSite();
	const importSite = useImportSite();

	// Picked backup lives in component state — survives navigation between
	// steps but not a hard refresh. If the user lands on `step=configure`
	// with no picked backup, the effect below bounces them back to select.
	const [ picked, setPicked ] = useState< PickedBackup | null >( null );
	const [ submitError, setSubmitError ] = useState( '' );

	useEffect( () => {
		if ( activeStep === 'configure' && ! picked ) {
			void navigate( {
				to: '/onboarding/import',
				search: { step: 'select' },
				replace: true,
			} );
		}
	}, [ activeStep, picked, navigate ] );

	const handlePick = useCallback(
		async ( file: File ) => {
			const path = await connector.getFilePath( file );
			if ( ! path ) {
				setSubmitError(
					__( 'Unable to resolve the backup file path. Try choosing the file via the button.' )
				);
				return;
			}
			setSubmitError( '' );
			setPicked( { file, path } );
			void navigate( {
				to: '/onboarding/import',
				search: { step: 'configure' },
			} );
		},
		[ connector, navigate ]
	);

	const handleClearPick = useCallback( () => {
		setPicked( null );
	}, [] );

	const handleBackToSelect = useCallback( () => {
		void navigate( {
			to: '/onboarding/import',
			search: { step: 'select' },
		} );
	}, [ navigate ] );

	const handleSubmit = async ( values: CreateSiteFormValues ) => {
		if ( ! picked ) return;
		setSubmitError( '' );
		try {
			const site = await createSite.mutateAsync( {
				name: values.name,
				path: values.path,
				phpVersion: values.phpVersion,
				wpVersion: values.wpVersion,
				customDomain: values.customDomain,
				enableHttps: values.enableHttps,
				adminUsername: values.adminUsername || undefined,
				adminPassword: values.adminPassword || undefined,
				adminEmail: values.adminEmail || undefined,
			} );
			await importSite.mutateAsync( {
				siteId: site.id,
				backup: { path: picked.path, type: picked.file.type },
			} );
			await navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
		} catch ( error ) {
			setSubmitError(
				error instanceof Error ? error.message : __( 'Failed to import site. Please try again.' )
			);
		}
	};

	if ( activeStep === 'select' ) {
		return (
			<div className={ sharedStyles.page }>
				<h1 className={ sharedStyles.title }>{ __( 'Import from a backup' ) }</h1>
				<p className={ sharedStyles.subtitle }>
					{ __(
						'Drop a backup archive to restore a site locally. Jetpack, All-in-One WP Migration, Local, and Playground exports are supported.'
					) }
				</p>
				<BackupDropzone
					selectedFile={ picked?.file ?? null }
					onPick={ ( file ) => void handlePick( file ) }
					onClear={ handleClearPick }
				/>
			</div>
		);
	}

	// `step=configure` with no picked backup is handled by the effect above;
	// render nothing in the intermediate frame to avoid a flash.
	if ( ! picked ) return null;

	const initialValues: Partial< CreateSiteFormValues > = {
		name: nameFromFilename( picked.file.name ),
	};
	const isSubmitting = createSite.isPending || importSite.isPending;

	return (
		<div className={ sharedStyles.page }>
			<Button
				type="button"
				variant="minimal"
				tone="neutral"
				className={ styles.backLink }
				onClick={ handleBackToSelect }
			>
				<Icon icon={ arrowLeft } />
				<span>{ __( 'Back to backup' ) }</span>
			</Button>
			<h1 className={ sharedStyles.title }>{ __( 'Configure the imported site' ) }</h1>
			<p className={ sharedStyles.subtitle }>
				{ __( 'Pick a name and local folder. The backup will restore on top of this new site.' ) }
			</p>
			<CreateSiteForm
				initialValues={ initialValues }
				existingDomainNames={ existingDomainNames ?? [] }
				onSubmit={ handleSubmit }
				onCancel={ () => void navigate( { to: '/onboarding' } ) }
				isSubmitting={ isSubmitting }
				submitError={ submitError }
				submitLabel={ __( 'Import site' ) }
			/>
		</div>
	);
}

export const onboardingImportRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/import',
	validateSearch: ( search: Record< string, unknown > ): ImportSearch => {
		const value = search.step;
		if ( value === 'configure' || value === 'select' ) {
			return { step: value };
		}
		return {};
	},
	component: OnboardingImportPage,
} );
