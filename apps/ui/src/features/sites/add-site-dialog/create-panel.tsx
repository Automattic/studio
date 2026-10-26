import { DEFAULT_MODEL } from '@studio/common/ai/models';
import {
	extractFormValuesFromBlueprint,
	updateBlueprintWithFormValues,
} from '@studio/common/lib/blueprint-settings';
import { generateCustomDomainFromSiteName } from '@studio/common/lib/domains';
import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { useNavigate } from '@tanstack/react-router';
import { __, _n, sprintf } from '@wordpress/i18n';
import { CloudDownloadIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useConnector } from '@/data/core';
import {
	useExistingCustomDomains,
	useProposedSiteName,
} from '@/data/queries/use-create-site-helpers';
import { useCreateSession } from '@/data/queries/use-sessions';
import { useCreateSite, useSites } from '@/data/queries/use-sites';
import { useWordPressOrgPackageName } from '@/data/queries/use-wordpress-org-package-name';
import { Composer, type ComposerHandle } from '@/features/composer';
import { pendingPromptSlot } from '@/features/composer';
import { BlueprintUpload, type SelectedBlueprint } from '@/features/sites/blueprint-upload';
import { CreateSiteForm } from '@/features/sites/create-site-form';
import { pendingBlueprintSlot } from '@/features/sites/pending-blueprint';
import { Field, FieldDescription, FieldTitle } from '@/lib/ui';
import { useConnectSite } from './connect-site';
import { useAddSite } from './context';
import localStyles from './create-panel.module.css';
import { getRemoteSiteName } from './site-presentation';
import type { AiModelId, SyncSite } from '@/data/core';
import type { CreateSiteFormError, CreateSiteFormValues } from '@/features/sites/create-site-form';

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

function getSourceIdentifier( source: string ): string {
	const normalized = source.split( /[?#]/, 1 )[ 0 ].replace( /\/$/, '' );
	const filename = normalized.split( '/' ).pop() || normalized;
	try {
		return decodeURIComponent( filename ).replace( /\.(git|zip)$/i, '' );
	} catch {
		return filename.replace( /\.(git|zip)$/i, '' );
	}
}

interface BlueprintPackage {
	name: string;
	url?: string;
	wordpressOrg?: {
		kind: 'plugin' | 'theme';
		slug: string;
	};
}

function BlueprintPackageName( { package: blueprintPackage }: { package: BlueprintPackage } ) {
	const connector = useConnector();
	const { name, url, wordpressOrg } = blueprintPackage;
	const { data: wordpressOrgName } = useWordPressOrgPackageName(
		wordpressOrg?.kind,
		wordpressOrg?.slug
	);
	const displayName = wordpressOrgName ?? name;

	if ( ! url ) {
		return displayName;
	}
	const linkLabel = url.startsWith( 'https://wordpress.org/' )
		? __( 'Open on WordPress.org' )
		: __( 'Open source page' );

	return (
		<a
			href={ url }
			title={ linkLabel }
			target="_blank"
			rel="noreferrer noopener"
			onClick={ ( event ) => {
				event.preventDefault();
				void connector.openExternalUrl( url );
			} }
		>
			{ displayName }
		</a>
	);
}

function getResourceDetails(
	resource: unknown,
	kind: 'plugin' | 'theme'
): BlueprintPackage | null {
	if ( typeof resource === 'string' ) {
		return { name: getSourceIdentifier( resource ) };
	}
	if ( ! resource || typeof resource !== 'object' ) {
		return null;
	}
	const details = resource as Record< string, unknown >;
	if ( typeof details.slug === 'string' && details.slug ) {
		return {
			name: details.slug,
			url: `https://wordpress.org/${ kind === 'plugin' ? 'plugins' : 'themes' }/${ details.slug }/`,
			wordpressOrg: { kind, slug: details.slug },
		};
	}
	if ( typeof details.url === 'string' && details.url ) {
		return { name: getSourceIdentifier( details.url ), url: details.url };
	}
	if ( typeof details.path === 'string' && details.path ) {
		const name = getSourceIdentifier( details.path );
		return {
			name,
			wordpressOrg: { kind, slug: name },
		};
	}
	return null;
}

function getBlueprintPackages( blueprint: SelectedBlueprint[ 'blueprint' ] ) {
	const plugins: BlueprintPackage[] = [];
	const themes: BlueprintPackage[] = [];
	for ( const rawStep of blueprint.steps ?? [] ) {
		if ( ! rawStep || typeof rawStep !== 'object' ) continue;
		const step = rawStep as unknown as Record< string, unknown >;
		if ( step.step === 'installPlugin' ) {
			const details = getResourceDetails( step.pluginData ?? step.pluginZipFile, 'plugin' );
			if ( details ) plugins.push( details );
		}
		if ( step.step === 'installTheme' ) {
			const details = getResourceDetails( step.themeData ?? step.themeZipFile, 'theme' );
			if ( details ) themes.push( details );
		}
	}
	return {
		plugins: [ ...new Map( plugins.map( ( item ) => [ item.name, item ] ) ).values() ],
		themes: [ ...new Map( themes.map( ( item ) => [ item.name, item ] ) ).values() ],
	};
}

function SelectedBlueprintSummary( {
	selected,
	onRemove,
}: {
	selected: SelectedBlueprint;
	onRemove: () => void;
} ) {
	const packages = getBlueprintPackages( selected.blueprint );

	return (
		<section className={ localStyles.summary } aria-labelledby="selected-blueprint-title">
			<div className={ localStyles.summaryHeader }>
				<h2>{ __( 'Blueprint' ) }</h2>
				<button type="button" className={ localStyles.summaryRemove } onClick={ onRemove }>
					{ __( 'Remove' ) }
				</button>
			</div>
			<div
				className={ `${ localStyles.summaryOverview } ${
					selected.image ? '' : localStyles.summaryOverviewWithoutImage
				}` }
			>
				{ selected.image && (
					<div className={ localStyles.summaryImageViewport }>
						<img src={ selected.image } alt="" className={ localStyles.summaryImage } />
					</div>
				) }
				<div className={ localStyles.summaryContent }>
					<h3 id="selected-blueprint-title" className={ localStyles.summaryTitle }>
						{ selected.title }
					</h3>
					{ selected.excerpt && (
						<p className={ localStyles.summaryExcerpt }>{ selected.excerpt }</p>
					) }
				</div>
			</div>
			{ ( packages.plugins.length > 0 || packages.themes.length > 0 ) && (
				<div className={ localStyles.summaryPackages }>
					{ packages.plugins.length > 0 && (
						<div className={ localStyles.summaryPackageGroup }>
							<h3>
								{ sprintf(
									_n( '%d plugin', '%d plugins', packages.plugins.length ),
									packages.plugins.length
								) }
							</h3>
							<ul>
								{ packages.plugins.map( ( plugin ) => (
									<li key={ plugin.name }>
										<BlueprintPackageName package={ plugin } />
									</li>
								) ) }
							</ul>
						</div>
					) }
					{ packages.themes.length > 0 && (
						<div className={ localStyles.summaryPackageGroup }>
							<h3>
								{ sprintf(
									_n( '%d theme', '%d themes', packages.themes.length ),
									packages.themes.length
								) }
							</h3>
							<ul>
								{ packages.themes.map( ( theme ) => (
									<li key={ theme.name }>
										<BlueprintPackageName package={ theme } />
									</li>
								) ) }
							</ul>
						</div>
					) }
				</div>
			) }
		</section>
	);
}

/**
 * The setup form for a new site: blank, from a Blueprint, or the local copy of
 * the `remote` site picked in Connect.
 */
export function CreatePanel( { remote, onCancel }: { remote?: SyncSite; onCancel: () => void } ) {
	const connector = useConnector();
	const navigate = useNavigate();
	const { setProgress, pinNewSite, setupDraft, setSetupDraft } = useAddSite();
	const [ restoredDraft ] = useState( setupDraft );
	const { data: sites } = useSites();
	const existingDomainNames = useExistingCustomDomains();
	const { data: proposedName } = useProposedSiteName(
		sites,
		remote && getRemoteSiteName( remote )
	);
	const createSite = useCreateSite();
	const connectSite = useConnectSite();
	const createSession = useCreateSession();
	const composerRef = useRef< ComposerHandle >( null );
	const [ model, setModel ] = useState< AiModelId >( DEFAULT_MODEL );
	const [ selectedBlueprint, setSelectedBlueprint ] = useState< SelectedBlueprint | null >( null );
	const [ isBlueprintValid, setIsBlueprintValid ] = useState( true );
	const [ existing, setExisting ] = useState( false );
	const [ submittedInitialValues, setSubmittedInitialValues ] =
		useState< Partial< CreateSiteFormValues > | null >( null );
	const selectedBlueprintRef = useRef< SelectedBlueprint | null >( null );
	const transferredTempDirRef = useRef< string | null >( null );
	const [ submitError, setSubmitError ] = useState< string | CreateSiteFormError >( '' );
	const pendingBlueprint = useSyncExternalStore(
		pendingBlueprintSlot.subscribe,
		pendingBlueprintSlot.getSnapshot
	);
	const showBrief = ! selectedBlueprint && ! remote && ! existing;
	const requiresCustomDomain = useMemo(
		() =>
			!! selectedBlueprint &&
			!! extractFormValuesFromBlueprint( selectedBlueprint.blueprint ).requiresCustomDomain,
		[ selectedBlueprint ]
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
		const blueprint = existing ? null : selectedBlueprintRef.current;
		const brief = showBrief ? composerRef.current?.getSubmission() : null;
		setSubmittedInitialValues( initialValues );
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
				...( brief ? { flowType: 'ai' as const } : {} ),
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
			if ( brief ) {
				const session = await createSession.mutateAsync( {
					siteId: site.id,
					model: model !== DEFAULT_MODEL ? model : undefined,
				} );
				pendingPromptSlot.set( {
					sessionId: session.id,
					prompt: brief.prompt || __( 'Build this site using the attached files as references.' ),
					attachments: brief.attachments,
				} );
				await navigate( { to: '/sessions/$sessionId', params: { sessionId: session.id } } );
			} else {
				await navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
			}
		} catch ( error ) {
			setSubmittedInitialValues( null );
			setProgress( null );
			setSubmitError( {
				title: __( 'WordPress Studio could not create the site.' ),
				message: blueprint
					? __( 'Review the Blueprint, the site name and the local folder, then try again.' )
					: __( 'Review the site name and local folder, then try again.' ),
				details: getErrorMessage( error ),
			} );
			// The server keeps an uploaded bundle when creation fails; it's ours to clean up again.
			transferredTempDirRef.current = null;
		}
	};

	return (
		<div className={ localStyles.page }>
			<CreateSiteForm
				initialValues={ submittedInitialValues ?? initialValues }
				existingDomainNames={ existingDomainNames }
				onSubmit={ handleSubmit }
				onCancel={ onCancel }
				isSubmitting={ submittedInitialValues !== null }
				isSubmitDisabled={ ! isBlueprintValid }
				requiresCustomDomain={ requiresCustomDomain }
				submitError={ submitError }
				submitLabel={ selectedBlueprint ? __( 'Create site from Blueprint' ) : undefined }
				source={ remote?.url.replace( /^https?:\/\//, '' ) }
				sourceIcon={ <CloudDownloadIcon /> }
				onExistingChange={ setExisting }
				requiresEmptyPath={ !! remote }
				draft={ restoredDraft }
				onDraftChange={ setSetupDraft }
				panelFooter={
					selectedBlueprint ? (
						<SelectedBlueprintSummary
							selected={ selectedBlueprint }
							onRemove={ () => {
								setIsBlueprintValid( true );
								replaceBlueprint( null );
							} }
						/>
					) : undefined
				}
			>
				{ showBrief && (
					<Field>
						<FieldTitle>{ __( 'What should we create?' ) }</FieldTitle>
						<Composer
							ref={ composerRef }
							variant="field"
							busy={ false }
							model={ model }
							onModelChange={ setModel }
							onSend={ async () => undefined }
							onInterrupt={ async () => undefined }
							placeholder={ __(
								'A warm, modern website for my neighborhood bakery. Include a menu and our story…'
							) }
						/>
						<FieldDescription>
							{ __(
								'Optional. Add the audience, goals, style, or pages, plus reference images or files.'
							) }
						</FieldDescription>
					</Field>
				) }
			</CreateSiteForm>
			{ ! selectedBlueprint && ! remote && ! existing && (
				<div className={ localStyles.blueprint }>
					<BlueprintUpload
						onSelect={ replaceBlueprint }
						onRemove={ () => replaceBlueprint( null ) }
						onValidityChange={ setIsBlueprintValid }
					/>
				</div>
			) }
		</div>
	);
}
