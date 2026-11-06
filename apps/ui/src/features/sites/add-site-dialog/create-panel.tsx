import {
	extractFormValuesFromBlueprint,
	updateBlueprintWithFormValues,
} from '@studio/common/lib/blueprint-settings';
import { generateCustomDomainFromSiteName } from '@studio/common/lib/domains';
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	useExistingCustomDomains,
	useProposedSiteName,
} from '@/data/queries/use-create-site-helpers';
import { useCreateSite, useSites } from '@/data/queries/use-sites';
import { CreateSiteForm } from '@/features/sites/create-site-form';
import { usePendingSiteFolder } from '@/features/sites/pending-site-folder';
import { useConnectSite } from './connect-site';
import { useAddSite } from './context';
import { SetupSourceField } from './setup-source-field';
import { getRemoteSiteName } from './site-presentation';
import { useSetupPrompt } from './use-setup-prompt';
import type { SelectedSiteFolder, SyncSite } from '@/data/core';
import type { SelectedBlueprint } from '@/features/sites/blueprint-selection';
import type { CreateSiteFormValues } from '@/features/sites/create-site-form';

function mapBlueprintSettingsToFormValues(
	blueprint: SelectedBlueprint
): Partial< CreateSiteFormValues > {
	const settings = extractFormValuesFromBlueprint( blueprint.blueprint );
	const name = settings.siteName || blueprint.title;
	return {
		name,
		phpVersion: settings.phpVersion,
		wpVersion: settings.wpVersion,
		customDomain:
			settings.customDomain ??
			( settings.requiresCustomDomain ? generateCustomDomainFromSiteName( name ) : undefined ),
		enableHttps: settings.enableHttps,
		adminUsername: settings.adminUsername,
		adminPassword: settings.adminPassword,
	};
}

export function CreatePanel( { remote }: { remote?: SyncSite } ) {
	const {
		setProgress,
		pinNewSite,
		setupDraft,
		setSetupDraft,
		formActions,
		isBlueprintValid,
		source,
		setSource,
		folderResetKey,
		setBlueprintTransferred,
	} = useAddSite();
	const [ restoredDraft ] = useState( setupDraft );
	const { data: sites } = useSites();
	const existingDomainNames = useExistingCustomDomains();
	const selectedBlueprint = source.type === 'blueprint' ? source.blueprint : undefined;
	const { data: proposedName } = useProposedSiteName(
		sites,
		remote
			? getRemoteSiteName( remote )
			: selectedBlueprint
			? extractFormValuesFromBlueprint( selectedBlueprint.blueprint ).siteName ||
			  selectedBlueprint.title
			: undefined
	);
	const createSite = useCreateSite();
	const connectSite = useConnectSite();
	const [ existing, setExisting ] = useState( false );
	const [ submittedInitialValues, setSubmittedInitialValues ] =
		useState< Partial< CreateSiteFormValues > | null >( null );
	const selectedFolder = usePendingSiteFolder();
	const working = useRef( false );
	const prompt = useSetupPrompt( { enabled: ! remote, busy: submittedInitialValues !== null } );
	useEffect( () => () => setProgress( null ), [ setProgress ] );
	const requiresCustomDomain =
		!! selectedBlueprint &&
		!! extractFormValuesFromBlueprint( selectedBlueprint.blueprint ).requiresCustomDomain;
	const initialValues = useMemo(
		() => ( {
			...( selectedBlueprint ? mapBlueprintSettingsToFormValues( selectedBlueprint ) : {} ),
			...( proposedName ? { name: proposedName } : {} ),
		} ),
		[ proposedName, selectedBlueprint ]
	);

	const onFolderChange = useCallback(
		( folder: SelectedSiteFolder ) => {
			if (
				source.type === 'blank' ||
				( source.type === 'folder' && source.folder.path !== folder.path )
			) {
				setSource( { type: 'folder', folder } );
			}
		},
		[ source, setSource ]
	);

	const handleSubmit = async ( values: CreateSiteFormValues ) => {
		if ( working.current || prompt.hasCreatedSite() ) return;
		working.current = true;
		const blueprint = existing ? undefined : selectedBlueprint;
		const hasPrompt = prompt.capture();
		setSubmittedInitialValues( initialValues );
		setProgress( __( 'Creating site…' ) );
		setBlueprintTransferred( !! blueprint );
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
			const params = {
				...values,
				adminUsername: values.adminUsername || undefined,
				adminPassword: values.adminPassword || undefined,
				adminEmail: values.adminEmail || undefined,
			};
			if ( remote ) {
				await connectSite( remote, params );
				return;
			}
			const site = await createSite.mutateAsync( {
				...params,
				...( hasPrompt ? { flowType: 'ai' as const } : {} ),
				...( mergedBlueprint && blueprint
					? {
							blueprint: {
								blueprint: mergedBlueprint,
								filePath: blueprint.filePath,
								bundleUrl: blueprint.bundleUrl,
							},
					  }
					: {} ),
			} );
			pinNewSite( site.id );
			await prompt.finish( site.id );
		} catch {
			setSubmittedInitialValues( null );
			setProgress( null );
			setBlueprintTransferred( false );
		} finally {
			working.current = false;
		}
	};
	if ( prompt.recovery ) return prompt.recovery;
	return (
		<CreateSiteForm
			actionsContainer={ formActions }
			selectedFolder={ selectedFolder ?? undefined }
			initialValues={ submittedInitialValues ?? initialValues }
			existingDomainNames={ existingDomainNames }
			onSubmit={ handleSubmit }
			isSubmitting={ submittedInitialValues !== null }
			isSubmitDisabled={
				! isBlueprintValid ||
				( ! remote &&
					! existing &&
					( ( source.type === 'blueprint' && ! selectedBlueprint ) || source.type === 'import' ) )
			}
			requiresCustomDomain={ requiresCustomDomain }
			sourceControl={ <SetupSourceField disabled={ submittedInitialValues !== null } /> }
			onExistingChange={ setExisting }
			onFolderChange={ onFolderChange }
			resetPathKey={ folderResetKey }
			requiresExistingPath={ source.type === 'folder' }
			folderDescription={
				selectedBlueprint
					? __( 'Studio will create a site from this blueprint in an empty folder.' )
					: remote
					? __( 'Studio will create a local copy of this site in an empty folder.' )
					: undefined
			}
			requiresEmptyPath={ !! remote || !! selectedBlueprint }
			draft={ restoredDraft }
			onDraftChange={ setSetupDraft }
		>
			{ prompt.field }
		</CreateSiteForm>
	);
}
