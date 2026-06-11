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
	// doesn't have to await the preload bridge again.
	path: string;
}

/**
 * Configure-and-import step. The backup file itself is always picked on the
 * onboarding home screen (its drop-target card) and handed over through the
 * pending-backup slot — this route has no picker of its own.
 */
export function OnboardingImportPage() {
	const navigate = useNavigate();

	const { data: existingDomainNames } = useExistingCustomDomains();
	const createSite = useCreateSite();
	const importSite = useImportSite();

	const [ picked, setPicked ] = useState< PickedBackup | null >( null );
	const [ submitError, setSubmitError ] = useState( '' );
	const pending = useSyncExternalStore( pendingBackupSlot.subscribe, pendingBackupSlot.peek );

	// Adopt a pending hand-off whenever one arrives — including while another
	// backup is already being configured, so a fresh hand-off always wins and
	// the slot never holds a stale value.
	useEffect( () => {
		if ( ! pending ) {
			return;
		}
		setPicked( pending );
		pendingBackupSlot.clear();
	}, [ pending ] );

	// Landing here with nothing picked and nothing pending (hard refresh,
	// direct URL, history navigation) returns to the home screen, where the
	// import drop card lives.
	useEffect( () => {
		if ( picked || pending ) {
			return;
		}
		void navigate( { to: '/onboarding', replace: true } );
	}, [ picked, pending, navigate ] );

	// The filename-derived site name can collide with an existing site
	// folder; resolve an available variant ("Name", "Name 2", ...) before
	// seeding the form, like the desktop renderer does.
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

	// The bounce effect above handles the empty case; render nothing in the
	// intermediate frame to avoid a flash.
	if ( ! picked ) return null;

	// Hold the form until the collision-checked name resolves — initial
	// values are applied once, so seeding early with a colliding name would
	// lock it in.
	const initialValues: Partial< CreateSiteFormValues > | undefined = seededName
		? { name: seededName }
		: undefined;
	const isSubmitting = createSite.isPending || importSite.isPending;

	return (
		<div className={ sharedStyles.page }>
			<h1 className={ sharedStyles.title }>{ __( 'Configure the imported site' ) }</h1>
			<p className={ sharedStyles.subtitle }>
				{ __( 'Pick a name and local folder. The backup will restore on top of this new site.' ) }
			</p>
			<CreateSiteForm
				initialValues={ initialValues }
				existingDomainNames={ existingDomainNames ?? [] }
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
