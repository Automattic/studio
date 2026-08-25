import {
	extractFormValuesFromBlueprint,
	updateBlueprintWithFormValues,
} from '@studio/common/lib/blueprint-settings';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { speak } from '@wordpress/a11y';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BlueprintUpload, type SelectedBlueprint } from '@/components/blueprint-upload';
import { CreateSiteForm } from '@/components/create-site-form';
import { useConnector } from '@/data/core';
import {
	useExistingCustomDomains,
	useProposedSiteName,
} from '@/data/queries/use-create-site-helpers';
import { useCreateSite, useSites } from '@/data/queries/use-sites';
import { useSeededSiteName } from '@/hooks/use-seeded-site-name';
import { pendingBlueprintSlot } from '@/lib/pending-blueprint';
import { onboardingLayoutRoute, useOnboardingProgress } from '../layout-onboarding';
import styles from '../layout-onboarding/style.module.css';
import localStyles from './style.module.css';
import type { CreateSiteFormValues } from '@/components/create-site-form';

function mapBlueprintSettingsToFormValues(
	blueprint: SelectedBlueprint
): Partial< CreateSiteFormValues > {
	const settings = extractFormValuesFromBlueprint( blueprint.blueprint );
	return {
		name: settings.siteName || blueprint.title,
		phpVersion: settings.phpVersion,
		wpVersion: settings.wpVersion,
		customDomain: settings.customDomain,
		enableHttps: settings.enableHttps,
		adminUsername: settings.adminUsername,
		adminPassword: settings.adminPassword,
	};
}

/**
 * The one create-site screen: name the site and go. A blueprint is an
 * optional power-up rather than its own step — dropped/uploaded here (or
 * handed over by the `wp-studio://add-site` deep link via the
 * pending-blueprint slot), it reseeds the form and rides along on submit.
 */
export function CreateSitePage() {
	const connector = useConnector();
	const navigate = useNavigate();
	const { setProgress } = useOnboardingProgress();
	const { data: sites } = useSites();
	const existingDomainNames = useExistingCustomDomains();
	const { data: proposedName } = useProposedSiteName( sites );
	const createSite = useCreateSite();
	const [ selectedBlueprint, setSelectedBlueprint ] = useState< SelectedBlueprint | null >( null );
	const [ isBlueprintValid, setIsBlueprintValid ] = useState( true );
	const [ submittedInitialValues, setSubmittedInitialValues ] =
		useState< Partial< CreateSiteFormValues > | null >( null );
	const selectedBlueprintRef = useRef< SelectedBlueprint | null >( null );
	const transferredTempDirRef = useRef< string | null >( null );
	const [ submitError, setSubmitError ] = useState( '' );
	const pendingBlueprint = useSyncExternalStore(
		pendingBlueprintSlot.subscribe,
		pendingBlueprintSlot.getSnapshot
	);

	const cleanupBlueprint = useCallback(
		( blueprint: SelectedBlueprint | null ) => {
			if ( blueprint?.tempDir && blueprint.tempDir !== transferredTempDirRef.current ) {
				void connector.cleanupBlueprintTempDir( blueprint.tempDir ).catch( () => undefined );
			}
		},
		[ connector ]
	);

	const replaceBlueprint = useCallback(
		( blueprint: SelectedBlueprint | null ) => {
			cleanupBlueprint( selectedBlueprintRef.current );
			selectedBlueprintRef.current = blueprint;
			setSelectedBlueprint( blueprint );
			setSubmitError( '' );
		},
		[ cleanupBlueprint ]
	);

	useEffect( () => {
		if ( ! pendingBlueprint ) return;
		replaceBlueprint( pendingBlueprint );
		pendingBlueprintSlot.clear( pendingBlueprint );
	}, [ pendingBlueprint, replaceBlueprint ] );

	useEffect(
		() => () => {
			cleanupBlueprint( selectedBlueprintRef.current );
			setProgress( null );
		},
		[ cleanupBlueprint, setProgress ]
	);

	// A blueprint's preferred site name may collide with an existing site —
	// seed the form with an available variant ("Name", "Name 2", …) instead.
	const seededBlueprintName = useSeededSiteName(
		selectedBlueprint
			? extractFormValuesFromBlueprint( selectedBlueprint.blueprint ).siteName ||
					selectedBlueprint.title
			: null
	);

	const initialValues = useMemo(
		() => ( {
			...( proposedName ? { name: proposedName } : {} ),
			...( selectedBlueprint ? mapBlueprintSettingsToFormValues( selectedBlueprint ) : {} ),
			...( selectedBlueprint && seededBlueprintName ? { name: seededBlueprintName } : {} ),
		} ),
		[ proposedName, selectedBlueprint, seededBlueprintName ]
	);

	const handleSubmit = async ( values: CreateSiteFormValues ) => {
		const blueprint = selectedBlueprintRef.current;
		setSubmittedInitialValues( initialValues );
		setSubmitError( '' );
		setProgress( __( 'Creating site…' ) );
		transferredTempDirRef.current = blueprint?.tempDir ?? null;

		try {
			// Fold the user's edited form values back into the blueprint JSON so
			// any steps that reference them (defineSiteUrl, login, setSiteOptions,
			// preferredVersions) pick up the final values when the CLI runs it.
			const mergedBlueprint = blueprint
				? updateBlueprintWithFormValues( blueprint.blueprint, {
						phpVersion: values.phpVersion,
						wpVersion: values.wpVersion,
						customDomain: values.customDomain,
						enableHttps: values.enableHttps,
						adminUsername: values.adminUsername,
						adminPassword: values.adminPassword,
						siteName: values.name,
				  } )
				: undefined;
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
				...( mergedBlueprint && blueprint
					? {
							blueprint: {
								blueprint: mergedBlueprint,
								filePath: blueprint.filePath,
							},
					  }
					: {} ),
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
			setSubmittedInitialValues( null );
			setProgress( null );
			setSubmitError(
				error instanceof Error ? error.message : __( 'Failed to create site. Please try again.' )
			);
			if ( blueprint?.tempDir ) {
				await connector.cleanupBlueprintTempDir( blueprint.tempDir ).catch( () => undefined );
				transferredTempDirRef.current = null;
				if ( selectedBlueprintRef.current === blueprint ) {
					selectedBlueprintRef.current = null;
					setSelectedBlueprint( null );
				}
			}
		}
	};

	return (
		<div className={ styles.page }>
			<h1 className={ styles.title }>
				{ selectedBlueprint ? selectedBlueprint.title : __( 'Create a new site' ) }
			</h1>
			<p className={ styles.subtitle }>
				{ selectedBlueprint?.excerpt ||
					__( 'Choose a name and we’ll set up a fresh WordPress site on your machine.' ) }
			</p>
			<CreateSiteForm
				initialValues={ submittedInitialValues ?? initialValues }
				existingDomainNames={ existingDomainNames }
				onSubmit={ handleSubmit }
				onCancel={ () => void navigate( { to: '/onboarding' } ) }
				isSubmitting={ submittedInitialValues !== null }
				isSubmitDisabled={ ! isBlueprintValid }
				submitError={ submitError }
				submitLabel={ selectedBlueprint ? __( 'Create site from blueprint' ) : undefined }
			/>
			<div className={ localStyles.blueprint }>
				<BlueprintUpload
					selected={ selectedBlueprint }
					onSelect={ replaceBlueprint }
					onRemove={ () => replaceBlueprint( null ) }
					onValidityChange={ setIsBlueprintValid }
				/>
			</div>
		</div>
	);
}

export const onboardingCreateRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/create',
	component: CreateSitePage,
} );
