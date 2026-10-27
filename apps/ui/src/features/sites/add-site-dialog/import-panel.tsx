import { ACCEPTED_ADD_SITE_FILE_TYPES } from '@studio/common/constants';
import {
	getSuggestedSiteNameFromBackupFilename,
	isSupportedBackupFilename,
} from '@studio/common/lib/backup-files';
import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { ArchiveIcon, UploadIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import { useImportSite } from '@/data/queries/use-import-site';
import { useCreateSite, useDeleteSite } from '@/data/queries/use-sites';
import { CreateSiteForm } from '@/features/sites/create-site-form';
import { Button, Alert, AlertDescription } from '@/lib/ui';
import { useAddSite } from './context';
import styles from './import-panel.module.css';
import type { CreateSiteFormError, CreateSiteFormValues } from '@/features/sites/create-site-form';

type ImportPhase = 'preparing' | 'creating' | 'importing';

function getImportRecoveryMessage( details: string ): string {
	if ( /absolute path:/i.test( details ) ) {
		return __(
			'This backup contains a file path WordPress Studio cannot safely restore. Export the site again with a supported backup tool, then choose the new backup.'
		);
	}
	return __(
		'The backup may be damaged or use an unsupported format. WordPress Studio removed the incomplete site, so you can retry or choose another backup.'
	);
}

function createFailure( phase: ImportPhase, details: string ): CreateSiteFormError {
	if ( phase === 'preparing' ) {
		return {
			title: __( 'WordPress Studio could not access this backup.' ),
			message: __(
				'Check that the file is still available and readable, then try again or choose another backup.'
			),
			details,
		};
	}
	if ( phase === 'creating' ) {
		return {
			title: __( 'WordPress Studio could not create the site.' ),
			message: __( 'Review the site name and local folder, then try again.' ),
			details,
		};
	}
	return {
		title: __( 'WordPress Studio could not import this backup.' ),
		message: getImportRecoveryMessage( details ),
		details,
	};
}

export function BackupDropZone( { onFile }: { onFile: ( file: File ) => void } ) {
	const inputRef = useRef< HTMLInputElement >( null );
	const [ isDragging, setIsDragging ] = useState( false );
	const [ error, setError ] = useState( '' );

	const handleFile = ( file?: File ) => {
		if ( ! file ) return;
		// A .sql dump is a database without the files that go with it, so it can
		// only be imported over an existing site — not used to create one.
		if ( ! isSupportedBackupFilename( file.name, ACCEPTED_ADD_SITE_FILE_TYPES ) ) {
			setError(
				__(
					'This file type is not supported. Please use a .zip, .gz, .gzip, .tar, .tar.gz, .wpress, or .xml file'
				)
			);
			return;
		}
		setError( '' );
		onFile( file );
	};

	return (
		<>
			<div
				className={ styles.dropZone }
				data-dragging={ isDragging || undefined }
				onDragOver={ ( event ) => {
					event.preventDefault();
					setIsDragging( true );
				} }
				onDragLeave={ ( event ) => {
					if ( event.currentTarget.contains( event.relatedTarget as Node | null ) ) return;
					setIsDragging( false );
				} }
				onDrop={ ( event ) => {
					event.preventDefault();
					setIsDragging( false );
					handleFile( event.dataTransfer.files[ 0 ] );
				} }
			>
				<UploadIcon className={ styles.dropIcon } size={ 24 } />
				<p className={ styles.dropLabel }>{ __( 'Drop a WordPress backup here.' ) }</p>
				<input
					ref={ inputRef }
					type="file"
					accept={ ACCEPTED_ADD_SITE_FILE_TYPES.join( ',' ) }
					hidden
					onChange={ ( event ) => {
						handleFile( event.target.files?.[ 0 ] );
						event.target.value = '';
					} }
				/>
				<Button type="button" variant="outline" onClick={ () => inputRef.current?.click() }>
					{ __( 'Choose file' ) }
				</Button>
			</div>
			{ error ? (
				<Alert variant="destructive" className={ styles.dropError }>
					<AlertDescription>{ error }</AlertDescription>
				</Alert>
			) : null }
			<p className={ styles.dropHelp }>
				{ __(
					'Supports backups from WordPress.com, Jetpack, Local, Playground and All-in-One WP Migration, and WordPress export files (.xml).'
				) }
			</p>
		</>
	);
}

export function ImportPanel( {
	backup: selectedFile,
	onCancel,
	onChooseAnother,
}: {
	backup: File;
	onCancel: () => void;
	onChooseAnother: () => void;
} ) {
	const navigate = useNavigate();
	const connector = useConnector();
	const { setProgress, followSite, pinNewSite } = useAddSite();

	const existingDomainNames = useExistingCustomDomains();
	const createSite = useCreateSite();
	const importSite = useImportSite();
	const deleteSite = useDeleteSite();

	const [ submitError, setSubmitError ] = useState< CreateSiteFormError | null >( null );
	const [ hasFailed, setHasFailed ] = useState( false );
	const [ isWorking, setIsWorking ] = useState( false );
	const isWorkingRef = useRef( false );

	useEffect( () => () => setProgress( null ), [ setProgress ] );

	const handleSubmit = async ( values: CreateSiteFormValues ) => {
		if ( isWorkingRef.current ) return;
		isWorkingRef.current = true;
		setIsWorking( true );
		setSubmitError( null );
		setProgress( __( 'Preparing backup…' ) );
		let phase: ImportPhase = 'preparing';
		let createdSiteId: string | null = null;
		let importCompleted = false;
		try {
			const backupPath = await connector.getFilePath( selectedFile );
			if ( ! backupPath ) {
				throw new Error( __( 'Unable to access the selected backup. Please try again.' ) );
			}

			phase = 'creating';
			setProgress( __( 'Creating site…' ) );
			const site = await createSite.mutateAsync( {
				name: values.name,
				path: values.path,
				phpVersion: values.phpVersion,
				fileAccess: values.fileAccess,
				wpVersion: values.wpVersion,
				customDomain: values.customDomain,
				enableHttps: values.enableHttps,
				adminUsername: values.adminUsername || undefined,
				adminPassword: values.adminPassword || undefined,
				adminEmail: values.adminEmail || undefined,
				// A running site's WP-CLI lookups race the database import; the import starts the
				// site once it's done. A WXR import needs the site's database to exist first.
				skipStart: ! backupPath.toLowerCase().endsWith( '.xml' ),
				flowType: 'import',
			} );
			createdSiteId = site.id;
			pinNewSite( site.id );
			phase = 'importing';
			setProgress( __( 'Importing backup…' ) );
			followSite( site.id );
			await importSite.mutateAsync( {
				siteId: site.id,
				backupPath,
				// `studio_site_imported` counts imports into existing sites only.
				suppressTracksEvent: true,
			} );
			importCompleted = true;
			await navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
		} catch ( error ) {
			setHasFailed( true );
			const failureDetails =
				getErrorMessage( error ) ?? __( 'Failed to import site. Please try again.' );
			if ( createdSiteId && ! importCompleted ) {
				setProgress( __( 'Removing incomplete site…' ) );
				try {
					await deleteSite.mutateAsync( { id: createdSiteId, deleteFiles: true } );
				} catch ( rollbackError ) {
					setSubmitError( {
						title: __( 'WordPress Studio could not finish cleaning up.' ),
						message: sprintf(
							__(
								'The import failed, and WordPress Studio could not remove “%s”. Remove the incomplete site before trying this location again.'
							),
							values.name
						),
						details: sprintf(
							__( 'Import error: %1$s\n\nCleanup error: %2$s' ),
							failureDetails,
							getErrorMessage( rollbackError ) ?? __( 'Unknown deletion error.' )
						),
					} );
					return;
				}
			}
			setSubmitError( createFailure( phase, failureDetails ) );
		} finally {
			isWorkingRef.current = false;
			setIsWorking( false );
			followSite( undefined );
			setProgress( null );
		}
	};

	const initialValues = useMemo< Partial< CreateSiteFormValues > >(
		() => ( {
			name: getSuggestedSiteNameFromBackupFilename( selectedFile.name ) || __( 'Imported site' ),
		} ),
		[ selectedFile ]
	);

	return (
		<div className={ styles.page }>
			<CreateSiteForm
				initialValues={ initialValues }
				existingDomainNames={ existingDomainNames }
				onSubmit={ handleSubmit }
				onCancel={ hasFailed ? onChooseAnother : onCancel }
				isSubmitting={ isWorking }
				submitError={ submitError ?? undefined }
				submitLabel={ hasFailed ? __( 'Retry import' ) : __( 'Import site' ) }
				cancelLabel={ hasFailed ? __( 'Choose another backup' ) : undefined }
				loadingAnnouncement={ __( 'Importing site' ) }
				source={ selectedFile.name }
				sourceIcon={ <ArchiveIcon /> }
			/>
		</div>
	);
}
