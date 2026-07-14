import {
	extractFormValuesFromBlueprint,
	updateBlueprintWithFormValues,
} from '@studio/common/lib/blueprint-settings';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { arrowLeft } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { BlueprintSelector, type PickedBlueprint } from '@/components/blueprint-selector';
import { CreateSiteForm } from '@/components/create-site-form';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import { useFeaturedBlueprints } from '@/data/queries/use-featured-blueprints';
import { useCreateSite } from '@/data/queries/use-sites';
import { onboardingLayoutRoute } from '../layout-onboarding';
import styles from '../layout-onboarding/style.module.css';
import localStyles from './style.module.css';
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
	// steps but not a hard refresh. If the user lands on `step=configure` with
	// no picked blueprint (refresh, direct URL), the effect below bounces them
	// back to the selector.
	const [ picked, setPicked ] = useState< PickedBlueprint | null >( null );
	const [ submitError, setSubmitError ] = useState( '' );

	useEffect( () => {
		if ( activeStep === 'configure' && ! picked ) {
			void navigate( {
				to: '/onboarding/blueprint',
				search: { step: 'select' },
				replace: true,
			} );
		}
	}, [ activeStep, picked, navigate ] );

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
			await navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
		} catch ( error ) {
			setSubmitError(
				error instanceof Error
					? error.message
					: __( 'Failed to create site from Blueprint. Please try again.' )
			);
		}
	};

	if ( activeStep === 'select' ) {
		return (
			<div className={ styles.page }>
				<h1 className={ styles.title }>{ __( 'Start from a Blueprint' ) }</h1>
				<p className={ styles.subtitle }>
					{ __(
						'Pick a featured Blueprint or drop in your own to provision plugins, content, and settings.'
					) }
				</p>
				<BlueprintSelector
					featured={ featured.data }
					isFeaturedLoading={ featured.isLoading }
					onPick={ handlePick }
				/>
			</div>
		);
	}

	// `step=configure` with no picked blueprint is handled by the effect
	// above; render nothing in the intermediate frame to avoid a flash.
	if ( ! picked ) return null;

	const initialValues = mapBlueprintSettingsToFormValues(
		extractFormValuesFromBlueprint( picked.blueprint ),
		picked.title
	);

	return (
		<div className={ styles.page }>
			<Button
				type="button"
				variant="minimal"
				tone="neutral"
				className={ localStyles.backLink }
				onClick={ handleBackToSelect }
			>
				<Icon icon={ arrowLeft } />
				<span>{ __( 'Back to Blueprints' ) }</span>
			</Button>
			<h1 className={ styles.title }>{ picked.title }</h1>
			{ picked.excerpt && <p className={ styles.subtitle }>{ picked.excerpt }</p> }
			<CreateSiteForm
				initialValues={ initialValues }
				existingDomainNames={ existingDomainNames }
				onSubmit={ handleSubmit }
				onCancel={ () => void navigate( { to: '/onboarding' } ) }
				isSubmitting={ createSite.isPending }
				submitError={ submitError }
				submitLabel={ __( 'Create site from Blueprint' ) }
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
