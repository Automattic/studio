import { createRoute, useNavigate } from '@tanstack/react-router';
import { speak } from '@wordpress/a11y';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { CreateSiteForm } from '@/components/create-site-form';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import { useImportSite } from '@/data/queries/use-import-site';
import { useCreateSite } from '@/data/queries/use-sites';
import { useSeededSiteName } from '@/hooks/use-seeded-site-name';
import { nameFromFilename } from '@/lib/backup-files';
import { pendingBackupSlot } from '@/lib/pending-backup';
import { onboardingLayoutRoute } from '../layout-onboarding';
import sharedStyles from '../layout-onboarding/style.module.css';
import type { CreateSiteFormValues } from '@/components/create-site-form';

interface PickedBackup {
	file: File;
	// Resolved from the connector once at pick-time so the submit handler
	// can pass an absolute path to the main process import handler.
	path: string;
}

export function OnboardingImportPage() {
	const navigate = useNavigate();
	const existingDomainNames = useExistingCustomDomains();
	const createSite = useCreateSite();
	const importSite = useImportSite();

	const [ picked, setPicked ] = useState< PickedBackup | null >( null );
	const [ submitError, setSubmitError ] = useState( '' );
	const pending = useSyncExternalStore( pendingBackupSlot.subscribe, pendingBackupSlot.peek );

	// Adopt a backup selected from the onboarding home card. A later pick
	// replaces the current one so repeated drops/clicks always win.
	useEffect( () => {
		if ( ! pending ) {
			return;
		}
		setPicked( pending );
		pendingBackupSlot.clear();
	}, [ pending ] );

	// Direct visits and refreshes have no File object to import, so send the
	// user back to the picker card on the home screen.
	useEffect( () => {
		if ( picked || pending ) {
			return;
		}
		void navigate( { to: '/onboarding', replace: true } );
	}, [ picked, pending, navigate ] );

	const seededName = useSeededSiteName( picked ? nameFromFilename( picked.file.name ) : null );

	const handleBack = useCallback( () => {
		void navigate( { to: '/onboarding' } );
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
			speak(
				sprintf(
					// translators: %s is the site name.
					__( '%s site added.' ),
					values.name
				)
			);
			await navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
		} catch ( error ) {
			setSubmitError(
				error instanceof Error ? error.message : __( 'Failed to import site. Please try again.' )
			);
		}
	};

	if ( ! picked ) return null;

	const isSubmitting = createSite.isPending || importSite.isPending;
	const initialValues: Partial< CreateSiteFormValues > | undefined = seededName
		? { name: seededName }
		: undefined;

	return (
		<div className={ sharedStyles.page }>
			<h1 className={ sharedStyles.title }>{ __( 'Configure the imported site' ) }</h1>
			<p className={ sharedStyles.subtitle }>
				{ __( 'Pick a name and local folder. The backup will restore on top of this new site.' ) }
			</p>
			<CreateSiteForm
				initialValues={ initialValues }
				existingDomainNames={ existingDomainNames }
				onSubmit={ handleSubmit }
				onCancel={ handleBack }
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
	component: OnboardingImportPage,
} );
