import { inspectBlueprint } from '@studio/blueprints';
import { generateCustomDomainFromSiteName } from '@studio/common/lib/domains';
import { isSupportedPHPVersion } from '@studio/common/types/php-versions';
import { __ } from '@wordpress/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import type { SyncSite } from '@/data/core';
import type { SelectedBlueprint } from '@/features/sites/blueprint-selection';
import type { CreateSiteFormValues } from '@/features/sites/create-site-form';

function parseSiteUrl( siteUrl: string | undefined ) {
	try {
		return siteUrl ? new URL( siteUrl ) : undefined;
	} catch {
		return undefined;
	}
}

export function mapBlueprintToFormValues(
	blueprint: SelectedBlueprint
): Partial< CreateSiteFormValues > {
	const details = inspectBlueprint( blueprint.blueprint );
	const name = details.siteTitle || blueprint.title;
	const siteUrl = parseSiteUrl( details.siteUrl );
	return {
		name,
		phpVersion: isSupportedPHPVersion( details.phpVersion ) ? details.phpVersion : undefined,
		wpVersion: details.wpVersion !== 'latest' ? details.wpVersion : undefined,
		customDomain:
			siteUrl?.hostname ??
			( details.multisite ? generateCustomDomainFromSiteName( name ) : undefined ),
		enableHttps: siteUrl ? siteUrl.protocol === 'https:' : undefined,
		adminUsername: details.login?.username,
		adminPassword: details.login?.password,
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
		adoptFolder,
		folderResetKey,
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
			? inspectBlueprint( selectedBlueprint.blueprint ).siteTitle || selectedBlueprint.title
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
		!! selectedBlueprint && inspectBlueprint( selectedBlueprint.blueprint ).multisite;
	const initialValues = useMemo(
		() => ( {
			...( selectedBlueprint ? mapBlueprintToFormValues( selectedBlueprint ) : {} ),
			...( ( remote || selectedBlueprint ) && proposedName ? { name: proposedName } : {} ),
		} ),
		[ remote, proposedName, selectedBlueprint ]
	);

	const handleSubmit = async ( values: CreateSiteFormValues ) => {
		if ( working.current || prompt.hasCreatedSite() ) return;
		working.current = true;
		const blueprint = existing ? undefined : selectedBlueprint;
		const hasPrompt = prompt.capture();
		setSubmittedInitialValues( initialValues );
		setProgress( __( 'Creating site…' ) );
		try {
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
				...( blueprint ? { blueprint: blueprint.source } : {} ),
			} );
			pinNewSite( site.id );
			await prompt.finish( site.id );
		} catch {
			setSubmittedInitialValues( null );
			setProgress( null );
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
			suggestedName={ proposedName }
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
			onFolderChange={ adoptFolder }
			resetPathKey={ folderResetKey }
			requiresExistingPath={ source.type === 'folder' }
			folderDescription={
				selectedBlueprint
					? __( 'WordPress Studio will create a site from this blueprint in an empty folder.' )
					: remote
					? __( 'WordPress Studio will create a local copy of this site in an empty folder.' )
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
