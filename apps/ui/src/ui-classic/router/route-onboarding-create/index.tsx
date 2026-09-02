import {
	extractFormValuesFromBlueprint,
	updateBlueprintWithFormValues,
} from '@studio/common/lib/blueprint-settings';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { __, _n, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BlueprintUpload, type SelectedBlueprint } from '@/components/blueprint-upload';
import { CreateSiteForm } from '@/components/create-site-form';
import { useConnector } from '@/data/core';
import {
	useExistingCustomDomains,
	useProposedSiteName,
} from '@/data/queries/use-create-site-helpers';
import { useCreateSite, useSites } from '@/data/queries/use-sites';
import { useWordPressOrgPackageName } from '@/data/queries/use-wordpress-org-package-name';
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

	const initialValues = useMemo(
		() => ( {
			...( proposedName ? { name: proposedName } : {} ),
			...( selectedBlueprint ? mapBlueprintSettingsToFormValues( selectedBlueprint ) : {} ),
		} ),
		[ proposedName, selectedBlueprint ]
	);

	const handleSubmit = async ( values: CreateSiteFormValues ) => {
		const blueprint = selectedBlueprintRef.current;
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
								bundleUrl: blueprint.bundleUrl,
							},
					  }
					: {} ),
			} );
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
			<h1 className={ styles.title }>{ __( 'Create a new site' ) }</h1>
			<p className={ styles.subtitle }>
				{ __( "Choose a name and we'll set up a fresh WordPress site on your machine." ) }
			</p>
			<CreateSiteForm
				initialValues={ submittedInitialValues ?? initialValues }
				existingDomainNames={ existingDomainNames }
				onSubmit={ handleSubmit }
				onCancel={ () => void navigate( { to: '/onboarding' } ) }
				isSubmitting={ submittedInitialValues !== null }
				isSubmitDisabled={ ! isBlueprintValid }
				submitError={ submitError }
				submitLabel={ selectedBlueprint ? __( 'Create site from Blueprint' ) : undefined }
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
			/>
			{ ! selectedBlueprint && (
				<div className={ localStyles.blueprint }>
					<BlueprintUpload
						selected={ null }
						onSelect={ replaceBlueprint }
						onRemove={ () => replaceBlueprint( null ) }
						onValidityChange={ setIsBlueprintValid }
					/>
				</div>
			) }
		</div>
	);
}

export const onboardingCreateRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/create',
	component: CreateSitePage,
} );
