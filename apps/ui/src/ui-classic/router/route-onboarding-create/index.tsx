import { DEFAULT_MODEL } from '@studio/common/ai/models';
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
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import {
	useExistingCustomDomains,
	useProposedSiteName,
} from '@/data/queries/use-create-site-helpers';
import { useCreateSite, useSites } from '@/data/queries/use-sites';
import { pendingBlueprintSlot } from '@/lib/pending-blueprint';
import { Composer, type ComposerHandle } from '@/ui-classic/components/session-view/composer';
import { onboardingLayoutRoute, useOnboardingProgress } from '../layout-onboarding';
import styles from '../layout-onboarding/style.module.css';
import { startConcurrentDesignGeneration } from './generation';
import localStyles from './style.module.css';
import type { CreateSiteFormValues } from '@/components/create-site-form';
import type { AiModelId } from '@/data/core';

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
	const { chatEnabled } = useAgenticFeatures();
	const composerRef = useRef< ComposerHandle >( null );
	const [ model, setModel ] = useState< AiModelId >( DEFAULT_MODEL );
	const [ hasBriefContent, setHasBriefContent ] = useState( false );
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

	const showComposer = chatEnabled && ! selectedBlueprint;

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

	const handleDraftChange = useCallback( ( text: string, hasAttachments: boolean ) => {
		setHasBriefContent( text.trim().length > 0 || hasAttachments );
	}, [] );

	const handleSubmit = async ( values: CreateSiteFormValues ) => {
		const blueprint = selectedBlueprintRef.current;
		const submission = showComposer ? composerRef.current?.getSubmission() : undefined;
		const useAi = ! blueprint && showComposer && hasBriefContent && !! submission;
		setSubmittedInitialValues( initialValues );
		setSubmitError( '' );
		setProgress( useAi ? __( 'Creating your AI site…' ) : __( 'Creating site…' ) );
		transferredTempDirRef.current = blueprint?.tempDir ?? null;
		let createdSiteId: string | undefined;

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
				...( useAi
					? { flowType: 'ai' as const }
					: {
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
					  } ),
			} );
			createdSiteId = site.id;
			if ( useAi && submission ) {
				const { session } = await startConcurrentDesignGeneration( {
					connector,
					siteId: site.id,
					brief: submission.prompt,
					model,
					attachments: submission.attachments,
				} );
				await navigate( { to: '/sessions/$sessionId', params: { sessionId: session.id } } );
			} else {
				await navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
			}
		} catch ( error ) {
			setSubmittedInitialValues( null );
			setProgress( null );
			setSubmitError(
				error instanceof Error ? error.message : __( 'Failed to create site. Please try again.' )
			);
			if ( useAi && createdSiteId ) {
				await connector.deleteSite( createdSiteId, true ).catch( () => undefined );
			}
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
			<h1 className={ styles.title }>{ __( 'Create a site' ) }</h1>
			<p className={ styles.subtitle }>
				{ chatEnabled
					? __( 'Describe it with AI, start from a Blueprint, or build it from scratch.' )
					: __( "Choose a name and we'll set up a fresh WordPress site on your machine." ) }
			</p>
			<CreateSiteForm
				initialValues={ submittedInitialValues ?? initialValues }
				existingDomainNames={ existingDomainNames }
				onSubmit={ handleSubmit }
				onCancel={ () => void navigate( { to: '/onboarding' } ) }
				isSubmitting={ submittedInitialValues !== null }
				isSubmitDisabled={ ! isBlueprintValid }
				submitError={ submitError }
				submitLabel={
					selectedBlueprint
						? __( 'Create site from Blueprint' )
						: showComposer && hasBriefContent
						? __( 'Create site and designs' )
						: undefined
				}
			>
				{ showComposer && (
					<div className={ localStyles.composerField }>
						<span>{ __( 'What should we create?' ) }</span>
						<Composer
							ref={ composerRef }
							mode="draft"
							busy={ false }
							error={ null }
							model={ model }
							onModelChange={ setModel }
							onDraftChange={ handleDraftChange }
							onSend={ async () => undefined }
							onInterrupt={ async () => undefined }
							appearance="field"
							placeholder={ __(
								'A warm, modern website for my neighborhood bakery. Include a menu and our story…'
							) }
						/>
						<small>
							{ __(
								'Optional. Add the audience, goals, style, or pages, plus reference images or files.'
							) }
						</small>
					</div>
				) }
			</CreateSiteForm>
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
