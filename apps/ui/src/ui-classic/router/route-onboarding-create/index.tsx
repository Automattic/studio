import {
	extractFormValuesFromBlueprint,
	updateBlueprintWithFormValues,
} from '@studio/common/lib/blueprint-settings';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BlueprintUpload, type SelectedBlueprint } from '@/components/blueprint-upload';
import { CreateSiteForm } from '@/components/create-site-form';
import { useConnector } from '@/data/core';
import {
	useExistingCustomDomains,
	useProposedSiteName,
} from '@/data/queries/use-create-site-helpers';
import { useCreateSite, useSites } from '@/data/queries/use-sites';
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

export function CreateSitePage() {
	const connector = useConnector();
	const navigate = useNavigate();
	const { setProgress } = useOnboardingProgress();
	const { data: sites } = useSites();
	const existingDomainNames = useExistingCustomDomains();
	const { data: proposedName } = useProposedSiteName( sites );
	const createSite = useCreateSite();
	const [ selectedBlueprint, setSelectedBlueprint ] = useState< SelectedBlueprint | null >( null );
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

	const initialValues = useMemo(
		() => ( {
			...( proposedName ? { name: proposedName } : {} ),
			...( selectedBlueprint ? mapBlueprintSettingsToFormValues( selectedBlueprint ) : {} ),
		} ),
		[ proposedName, selectedBlueprint ]
	);

	const handleSubmit = async ( values: CreateSiteFormValues ) => {
		const blueprint = selectedBlueprintRef.current;
		setSubmitError( '' );
		setProgress( __( 'Creating site…' ) );
		transferredTempDirRef.current = blueprint?.tempDir ?? null;

		try {
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
			await navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
		} catch ( error ) {
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
			<h1 className={ styles.title }>{ __( 'Create a new site' ) }</h1>
			<p className={ styles.subtitle }>
				{ __( 'Start with a blank site or upload a Blueprint to preconfigure it.' ) }
			</p>
			<section className={ localStyles.blueprint }>
				<h2 className={ localStyles.sectionTitle }>{ __( 'Blueprint (optional)' ) }</h2>
				<BlueprintUpload
					selected={ selectedBlueprint }
					onSelect={ replaceBlueprint }
					onRemove={ () => replaceBlueprint( null ) }
				/>
			</section>
			<CreateSiteForm
				initialValues={ initialValues }
				existingDomainNames={ existingDomainNames }
				onSubmit={ handleSubmit }
				onCancel={ () => void navigate( { to: '/onboarding' } ) }
				isSubmitting={ createSite.isPending }
				submitError={ submitError }
				submitLabel={ selectedBlueprint ? __( 'Create site from Blueprint' ) : undefined }
			/>
		</div>
	);
}

export const onboardingCreateRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/create',
	component: CreateSitePage,
} );
