import { getSuggestedSiteNameFromBackupFilename } from '@studio/common/lib/backup-files';
import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { getImportStatusMessage } from '@studio/common/lib/import-progress';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { speak } from '@wordpress/a11y';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CreateSiteForm } from '@/components/create-site-form';
import { useConnector } from '@/data/core';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import { useImportSite } from '@/data/queries/use-import-site';
import { useCreateSite, useDeleteSite } from '@/data/queries/use-sites';
import { useSeededSiteName } from '@/hooks/use-seeded-site-name';
import { pendingBackupSlot } from '@/lib/pending-backup';
import { onboardingLayoutRoute, useOnboardingProgress } from '../layout-onboarding';
import sharedStyles from '../layout-onboarding/style.module.css';
import type { CreateSiteFormError, CreateSiteFormValues } from '@/components/create-site-form';

type ImportPhase = 'preparing' | 'creating' | 'importing';

function getImportRecoveryMessage( details: string ): string {
	if ( /absolute path:/i.test( details ) ) {
		return __(
			'This backup contains a file path Studio cannot safely restore. Export the site again with a supported backup tool, then choose the new backup.'
		);
	}
	return __(
		'The backup may be damaged or use an unsupported format. Studio removed the incomplete site, so you can retry or choose another backup.'
	);
}

function createFailure( phase: ImportPhase, details: string ): CreateSiteFormError {
	if ( phase === 'preparing' ) {
		return {
			title: __( 'Studio could not access this backup.' ),
			message: __(
				'Check that the file is still available and readable, then try again or choose another backup.'
			),
			details,
		};
	}
	if ( phase === 'creating' ) {
		return {
			title: __( 'Studio could not create the site.' ),
			message: __( 'Review the site name and local folder, then try again.' ),
			details,
		};
	}
	return {
		title: __( 'Studio could not import this backup.' ),
		message: getImportRecoveryMessage( details ),
		details,
	};
}

export function OnboardingImportPage() {
	const navigate = useNavigate();
	const connector = useConnector();
	const { setProgress } = useOnboardingProgress();
	const existingDomainNames = useExistingCustomDomains();
	const createSite = useCreateSite();
	const importSite = useImportSite();
	const deleteSite = useDeleteSite();

	const [ selectedFile, setSelectedFile ] = useState< File | null >( null );
	const [ submitError, setSubmitError ] = useState< CreateSiteFormError | null >( null );
	const [ hasFailed, setHasFailed ] = useState( false );
	const [ isWorking, setIsWorking ] = useState( false );
	const isWorkingRef = useRef( false );
	const pending = useSyncExternalStore( pendingBackupSlot.subscribe, pendingBackupSlot.peek );

	useEffect( () => {
		if ( ! pending ) {
			return;
		}
		setSelectedFile( pending );
		pendingBackupSlot.clear();
	}, [ pending ] );

	useEffect( () => {
		if ( selectedFile || pending ) {
			return;
		}
		void navigate( { to: '/onboarding', replace: true } );
	}, [ navigate, pending, selectedFile ] );

	useEffect( () => () => setProgress( null ), [ setProgress ] );

	const seededName = useSeededSiteName(
		selectedFile ? getSuggestedSiteNameFromBackupFilename( selectedFile.name ) : null
	);

	const handleBack = useCallback( () => {
		void navigate( { to: '/onboarding' } );
	}, [ navigate ] );

	const handleSubmit = async ( values: CreateSiteFormValues ) => {
		if ( ! selectedFile || isWorkingRef.current ) {
			return;
		}
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
				runtime: values.runtime,
				fileAccess: values.fileAccess,
				wpVersion: values.wpVersion,
				customDomain: values.customDomain,
				enableHttps: values.enableHttps,
				adminUsername: values.adminUsername || undefined,
				adminPassword: values.adminPassword || undefined,
				adminEmail: values.adminEmail || undefined,
				flowType: 'import',
			} );
			createdSiteId = site.id;

			phase = 'importing';
			setProgress( __( 'Importing backup…' ) );
			await importSite.mutateAsync( {
				siteId: site.id,
				backupPath,
				onProgress: ( event ) => {
					const message = getImportStatusMessage( event );
					if ( message ) {
						setProgress( message );
					}
				},
			} );
			importCompleted = true;
			speak(
				sprintf(
					// translators: %s is the site name.
					__( '%s site added.' ),
					values.name
				)
			);
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
						title: __( 'Studio could not finish cleaning up.' ),
						message: sprintf(
							__(
								'The import failed, and Studio could not remove “%s”. Remove the incomplete site before trying this location again.'
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
			setProgress( null );
		}
	};

	if ( ! selectedFile ) {
		return null;
	}

	const initialValues: Partial< CreateSiteFormValues > | undefined = seededName
		? { name: seededName }
		: undefined;

	return (
		<div className={ sharedStyles.page }>
			<h1 className={ sharedStyles.title }>{ __( 'Set up your imported site' ) }</h1>
			<p className={ sharedStyles.subtitle }>
				{ __( 'Choose a name and local folder. The backup will restore on top of this new site.' ) }
			</p>
			<CreateSiteForm
				initialValues={ initialValues }
				existingDomainNames={ existingDomainNames }
				onSubmit={ handleSubmit }
				onCancel={ handleBack }
				isSubmitting={ isWorking }
				submitError={ submitError ?? undefined }
				submitLabel={ hasFailed ? __( 'Retry import' ) : __( 'Import site' ) }
				cancelLabel={ hasFailed ? __( 'Choose another backup' ) : undefined }
				loadingAnnouncement={ __( 'Importing site' ) }
			/>
		</div>
	);
}

export const onboardingImportRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/import',
	component: OnboardingImportPage,
} );
