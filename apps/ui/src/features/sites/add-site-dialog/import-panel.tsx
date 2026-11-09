import { getSuggestedSiteNameFromBackupFilename } from '@studio/common/lib/backup-files';
import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import { useImportSite } from '@/data/queries/use-import-site';
import { useCreateSite, useDeleteSite } from '@/data/queries/use-sites';
import { CreateSiteForm } from '@/features/sites/create-site-form';
import { usePendingSiteFolder } from '@/features/sites/pending-site-folder';
import { useAddSite, type SiteBackup } from './context';
import styles from './import-panel.module.css';
import { SetupSourceField } from './setup-source-field';
import { useSetupPrompt } from './use-setup-prompt';
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

function createFailure(
	phase: Exclude< ImportPhase, 'creating' >,
	details: string
): CreateSiteFormError {
	if ( phase === 'preparing' ) {
		return {
			title: __( 'WordPress Studio could not access this backup.' ),
			message: __(
				'Check that the file is still available and readable, then try again or choose another backup.'
			),
			details,
		};
	}
	return {
		title: __( 'WordPress Studio could not import this backup.' ),
		message: getImportRecoveryMessage( details ),
		details,
	};
}

export function ImportPanel( { backup: selectedFile }: { backup: SiteBackup } ) {
	const connector = useConnector();
	const {
		setProgress,
		followSite,
		pinNewSite,
		formActions,
		isBlueprintValid,
		setupDraft,
		setSetupDraft,
	} = useAddSite();
	const [ restoredDraft ] = useState( setupDraft );
	const selectedFolder = usePendingSiteFolder();

	const existingDomainNames = useExistingCustomDomains();
	const createSite = useCreateSite();
	const importSite = useImportSite();
	const deleteSite = useDeleteSite();

	const [ submitError, setSubmitError ] = useState< CreateSiteFormError | null >( null );
	const [ isWorking, setIsWorking ] = useState( false );
	const isWorkingRef = useRef( false );
	const prompt = useSetupPrompt( { busy: isWorking } );

	useEffect( () => () => setProgress( null ), [ setProgress ] );

	const handleSubmit = async ( values: CreateSiteFormValues ) => {
		if ( isWorkingRef.current || prompt.hasCreatedSite() || ! prompt.canSubmit ) return;
		prompt.capture();
		isWorkingRef.current = true;
		setIsWorking( true );
		setSubmitError( null );
		setProgress( __( 'Preparing backup…' ) );
		let phase: ImportPhase = 'preparing';
		let createdSiteId: string | null = null;
		let importCompleted = false;
		try {
			const backupPath =
				'path' in selectedFile ? selectedFile.path : await connector.getFilePath( selectedFile );
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
			await prompt.finish( site.id );
		} catch ( error ) {
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
			if ( phase !== 'creating' ) setSubmitError( createFailure( phase, failureDetails ) );
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

	if ( prompt.recovery ) return prompt.recovery;
	return (
		<div className={ styles.page }>
			<CreateSiteForm
				selectedFolder={ selectedFolder }
				actionsContainer={ formActions }
				initialValues={ initialValues }
				existingDomainNames={ existingDomainNames }
				onSubmit={ handleSubmit }
				isSubmitting={ isWorking }
				submitError={ submitError ?? undefined }
				isSubmitDisabled={ ! isBlueprintValid || ! prompt.canSubmit }
				folderDescription={
					selectedFile.name.toLowerCase().endsWith( '.xml' )
						? __( 'Studio will create a site in an empty folder and import this WordPress export.' )
						: __( 'Studio will restore this backup into an empty folder.' )
				}
				requiresEmptyPath
				draft={ restoredDraft }
				onDraftChange={ setSetupDraft }
				sourceControl={ <SetupSourceField disabled={ isWorking } /> }
			>
				{ prompt.field }
			</CreateSiteForm>
		</div>
	);
}
