import {
	extractFormValuesFromBlueprint,
	updateBlueprintWithFormValues,
} from '@studio/common/lib/blueprint-settings';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { speak } from '@wordpress/a11y';
import { __, sprintf } from '@wordpress/i18n';
import { chevronLeft } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { BlueprintSelector, type PickedBlueprint } from '@/components/blueprint-selector';
import { CreateSiteForm } from '@/components/create-site-form';
import { OnboardingFooter } from '@/components/onboarding-footer';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import { useFeaturedBlueprints } from '@/data/queries/use-featured-blueprints';
import { useCreateSite } from '@/data/queries/use-sites';
import { useSeededSiteName } from '@/hooks/use-seeded-site-name';
import { pendingBlueprintSlot } from '@/lib/pending-blueprint';
import { onboardingLayoutRoute } from '../layout-onboarding';
import styles from '../layout-onboarding/style.module.css';
import type { CreateSiteFormValues } from '@/components/create-site-form';

type Step = 'select' | 'configure';

interface BlueprintSearch {
	step?: Step;
}

function OnboardingBlueprintPage() {
	const { step } = onboardingBlueprintRoute.useSearch();
	const navigate = useNavigate();
	const activeStep: Step = step === 'configure' ? 'configure' : 'select';

	const featured = useFeaturedBlueprints();
	const existingDomainNames = useExistingCustomDomains();
	const createSite = useCreateSite();

	// Picked blueprint lives in component state — survives navigation between
	// steps but not a hard refresh. The pending-blueprint slot (populated by
	// the `wp-studio://add-site` deep link before it navigates here) hands a
	// blueprint over from outside the route.
	const [ picked, setPicked ] = useState< PickedBlueprint | null >( null );
	const [ submitError, setSubmitError ] = useState( '' );
	const pending = useSyncExternalStore( pendingBlueprintSlot.subscribe, pendingBlueprintSlot.peek );

	useEffect( () => {
		if ( activeStep !== 'configure' || ! pending ) {
			return;
		}
		setPicked( pending );
		setSubmitError( '' );
		pendingBlueprintSlot.clear();
	}, [ activeStep, pending ] );

	useEffect( () => {
		if ( activeStep !== 'configure' || picked || pending ) {
			return;
		}
		void navigate( {
			to: '/onboarding/blueprint',
			search: { step: 'select' },
			replace: true,
		} );
	}, [ activeStep, picked, pending, navigate ] );

	const seededName = useSeededSiteName(
		picked ? extractFormValuesFromBlueprint( picked.blueprint ).siteName || picked.title : null
	);

	const handlePick = useCallback(
		( blueprint: PickedBlueprint ) => {
			// `flushSync` commits the state updates *before* `navigate` fires so
			// the router's URL change and React's component state land in the
			// same render pass. Without this, tanstack router's store update
			// commits first, the component re-renders with `activeStep` already
			// at `configure` but `picked` still null, and the hard-refresh
			// guard effect below immediately bounces us back to `select`.
			flushSync( () => {
				setPicked( blueprint );
				setSubmitError( '' );
			} );
			void navigate( {
				to: '/onboarding/blueprint',
				search: { step: 'configure' },
			} );
		},
		[ navigate ]
	);

	const handleBackToSelect = useCallback( () => {
		void navigate( {
			to: '/onboarding/blueprint',
			search: { step: 'select' },
		} );
	}, [ navigate ] );

	const handleSubmit = async ( values: CreateSiteFormValues ) => {
		if ( ! picked ) return;
		setSubmitError( '' );
		// Fold the user's edited form values back into the blueprint JSON so
		// any steps that reference them (defineSiteUrl, login, setSiteOptions,
		// preferredVersions) pick up the final values when the CLI runs it.
		const mergedBlueprint = updateBlueprintWithFormValues( picked.blueprint, {
			phpVersion: values.phpVersion,
			wpVersion: values.wpVersion,
			customDomain: values.customDomain,
			enableHttps: values.enableHttps,
			adminUsername: values.adminUsername,
			adminPassword: values.adminPassword,
			siteName: values.name,
		} );
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
				blueprint: {
					blueprint: mergedBlueprint,
					slug: picked.slug,
					filePath: picked.filePath,
				},
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
				error instanceof Error
					? error.message
					: __( 'Failed to create site from blueprint. Please try again.' )
			);
		}
	};

	if ( activeStep === 'select' ) {
		return (
			<div className={ `${ styles.page } ${ styles.pageSpacious }` }>
				<h1 className={ styles.title }>{ __( 'Create a new site' ) }</h1>
				<p className={ styles.subtitle }>
					{ __( 'Choose a starting point for your new WordPress site.' ) }
				</p>
				<BlueprintSelector
					blueprints={ featured.data }
					isLoading={ featured.isLoading }
					onPick={ handlePick }
					onPickEmpty={ () => void navigate( { to: '/onboarding/create' } ) }
				/>
				<OnboardingFooter>
					<Button
						type="button"
						variant="minimal"
						tone="neutral"
						onClick={ () => void navigate( { to: '/onboarding' } ) }
					>
						<Icon icon={ chevronLeft } size={ 16 } />
						<span>{ __( 'Back' ) }</span>
					</Button>
				</OnboardingFooter>
			</div>
		);
	}

	// `step=configure` with no picked blueprint is handled by the effect
	// above; render nothing in the intermediate frame to avoid a flash.
	if ( ! picked ) return null;

	const initialValues = seededName
		? {
				...mapBlueprintSettingsToFormValues(
					extractFormValuesFromBlueprint( picked.blueprint ),
					picked.title
				),
				name: seededName,
		  }
		: undefined;

	return (
		<div className={ styles.page }>
			<h1 className={ styles.title }>{ picked.title }</h1>
			{ picked.excerpt && <p className={ styles.subtitle }>{ picked.excerpt }</p> }
			<CreateSiteForm
				initialValues={ initialValues }
				existingDomainNames={ existingDomainNames }
				onSubmit={ handleSubmit }
				onCancel={ handleBackToSelect }
				isSubmitting={ createSite.isPending }
				submitError={ submitError }
				submitLabel={ __( 'Create site from blueprint' ) }
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

export const onboardingBlueprintRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/blueprint',
	validateSearch: ( search: Record< string, unknown > ): BlueprintSearch => {
		const value = search.step;
		if ( value === 'configure' || value === 'select' ) {
			return { step: value };
		}
		return {};
	},
	component: OnboardingBlueprintPage,
} );
