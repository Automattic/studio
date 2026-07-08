import {
	extractFormValuesFromBlueprint,
	updateBlueprintWithFormValues,
} from '@studio/common/lib/blueprint-settings';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { speak } from '@wordpress/a11y';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { BlueprintUploadHint, type PickedBlueprint } from '@/components/blueprint-upload';
import { CreateSiteForm } from '@/components/create-site-form';
import {
	useExistingCustomDomains,
	useProposedSiteName,
} from '@/data/queries/use-create-site-helpers';
import { useCreateSite, useSites } from '@/data/queries/use-sites';
import { useSeededSiteName } from '@/hooks/use-seeded-site-name';
import { pendingBlueprintSlot } from '@/lib/pending-blueprint';
import { onboardingLayoutRoute } from '../layout-onboarding';
import styles from '../layout-onboarding/style.module.css';
import type { CreateSiteFormValues } from '@/components/create-site-form';

/**
 * The one create-site screen: name the site and go. A blueprint is an
 * optional power-up rather than its own step — dropped/uploaded here (or
 * handed over by the `wp-studio://add-site` deep link via the
 * pending-blueprint slot), it reseeds the form and rides along on submit.
 */
function CreateSitePage() {
	const navigate = useNavigate();
	const { data: sites } = useSites();
	const existingDomainNames = useExistingCustomDomains();
	const { data: proposedName } = useProposedSiteName( sites );
	const createSite = useCreateSite();
	const [ submitError, setSubmitError ] = useState( '' );

	const [ picked, setPicked ] = useState< PickedBlueprint | null >( null );
	const pending = useSyncExternalStore( pendingBlueprintSlot.subscribe, pendingBlueprintSlot.peek );
	useEffect( () => {
		if ( ! pending ) {
			return;
		}
		setPicked( pending );
		setSubmitError( '' );
		pendingBlueprintSlot.clear();
	}, [ pending ] );

	const seededBlueprintName = useSeededSiteName(
		picked ? extractFormValuesFromBlueprint( picked.blueprint ).siteName || picked.title : null
	);

	const handleSubmit = async ( values: CreateSiteFormValues ) => {
		setSubmitError( '' );
		// Fold the user's edited form values back into the blueprint JSON so
		// any steps that reference them (defineSiteUrl, login, setSiteOptions,
		// preferredVersions) pick up the final values when the CLI runs it.
		const mergedBlueprint = picked
			? updateBlueprintWithFormValues( picked.blueprint, {
					phpVersion: values.phpVersion,
					wpVersion: values.wpVersion,
					customDomain: values.customDomain,
					enableHttps: values.enableHttps,
					adminUsername: values.adminUsername,
					adminPassword: values.adminPassword,
					siteName: values.name,
			  } )
			: null;
		try {
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
				blueprint:
					picked && mergedBlueprint
						? {
								blueprint: mergedBlueprint,
								slug: picked.slug,
								filePath: picked.filePath,
						  }
						: undefined,
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
				error instanceof Error ? error.message : __( 'Failed to create site. Please try again.' )
			);
		}
	};

	const initialValues = picked
		? {
				...mapBlueprintSettingsToFormValues(
					extractFormValuesFromBlueprint( picked.blueprint ),
					picked.title
				),
				...( seededBlueprintName ? { name: seededBlueprintName } : {} ),
		  }
		: proposedName
		? { name: proposedName }
		: undefined;

	return (
		<div className={ styles.page }>
			<h1 className={ styles.title }>{ picked ? picked.title : __( 'Create a new site' ) }</h1>
			<p className={ styles.subtitle }>
				{ picked
					? picked.excerpt
					: __( 'Choose a name and we’ll set up a fresh WordPress site on your machine.' ) }
			</p>
			<CreateSiteForm
				// The form applies initialValues once; remount it when a
				// blueprint arrives so the blueprint's settings reseed it.
				key={ picked ? `blueprint-${ picked.slug ?? picked.title }` : 'empty' }
				initialValues={ initialValues }
				existingDomainNames={ existingDomainNames }
				onSubmit={ handleSubmit }
				onCancel={ () => void navigate( { to: '/onboarding' } ) }
				isSubmitting={ createSite.isPending }
				submitError={ submitError }
				submitLabel={ picked ? __( 'Create site from blueprint' ) : undefined }
			/>
			<BlueprintUploadHint
				onPick={ ( blueprint ) => {
					setPicked( blueprint );
					setSubmitError( '' );
				} }
			/>
		</div>
	);
}

/**
 * Translates the settings extracted from a blueprint into the shape the form
 * expects. PHP 7.2/7.3 are already filtered out upstream, but we still guard
 * against older blueprints sneaking in an unsupported value.
 */
function mapBlueprintSettingsToFormValues(
	settings: ReturnType< typeof extractFormValuesFromBlueprint >,
	fallbackName: string
): Partial< CreateSiteFormValues > {
	return {
		name: settings.siteName || fallbackName,
		phpVersion: settings.phpVersion,
		wpVersion: settings.wpVersion,
		customDomain: settings.customDomain,
		enableHttps: settings.enableHttps,
		adminUsername: settings.adminUsername,
		adminPassword: settings.adminPassword,
	};
}

export const onboardingCreateRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/create',
	component: CreateSitePage,
} );
