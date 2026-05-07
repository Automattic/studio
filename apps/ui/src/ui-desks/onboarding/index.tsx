import { ACCEPTED_IMPORT_FILE_TYPES } from '@studio/common/constants';
import {
	extractFormValuesFromBlueprint,
	updateBlueprintWithFormValues,
} from '@studio/common/lib/blueprint-settings';
import { createRoute } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { arrowLeft, download } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { BlueprintSelector, type PickedBlueprint } from '@/components/blueprint-selector';
import { CreateSiteForm } from '@/components/create-site-form';
import { FileDropzone } from '@/components/file-dropzone';
import { OnboardingLayout } from '@/components/onboarding-layout';
import { useConnector } from '@/data/core';
import {
	useExistingCustomDomains,
	useProposedSiteName,
} from '@/data/queries/use-create-site-helpers';
import { useFeaturedBlueprints } from '@/data/queries/use-featured-blueprints';
import { useImportSite } from '@/data/queries/use-import-site';
import { useCreateSite, useSites } from '@/data/queries/use-sites';
import { useDesksNavigate } from '../router/navigation';
import { desksRootRoute } from '../router/root';
import styles from './style.module.css';
import type { CreateSiteFormValues } from '@/components/create-site-form';

type Step = 'select' | 'configure';

interface StepSearch {
	step?: Step;
}

interface PickedBackup {
	file: File;
	path: string;
}

export function DeskOnboardingHome() {
	const navigate = useDesksNavigate();

	return (
		<OnboardingLayout onClose={ () => void navigate( { to: '/' } ) } width="wide">
			<div className={ styles.page }>
				<h1 className={ styles.title }>{ __( 'Start a new site' ) }</h1>
				<p className={ styles.subtitle }>
					{ __( 'WordPress can power anything. What are you building?' ) }
				</p>
				<div className={ styles.cards }>
					<button
						type="button"
						className={ styles.card }
						onClick={ () => void navigate( { to: '/onboarding/create' } ) }
					>
						<h3 className={ styles.cardTitle }>{ __( 'Create new' ) }</h3>
						<p className={ styles.cardBody }>
							{ __( 'Start fresh with a blank site and build it with AI' ) }
						</p>
					</button>
					<button
						type="button"
						className={ styles.card }
						onClick={ () =>
							void navigate( { to: '/onboarding/blueprint', search: { step: 'select' } } )
						}
					>
						<h3 className={ styles.cardTitle }>{ __( 'Start from a blueprint' ) }</h3>
						<p className={ styles.cardBody }>
							{ __(
								'Pick a featured blueprint or drop in your own to provision plugins, content, and settings.'
							) }
						</p>
					</button>
					<button
						type="button"
						className={ styles.card }
						onClick={ () =>
							void navigate( { to: '/onboarding/import', search: { step: 'select' } } )
						}
					>
						<h3 className={ styles.cardTitle }>{ __( 'Bring existing' ) }</h3>
						<p className={ styles.cardBody }>
							{ __( 'Import from a Jetpack backup or another full-site export' ) }
						</p>
					</button>
				</div>
			</div>
		</OnboardingLayout>
	);
}

export function DeskOnboardingCreate() {
	const navigate = useDesksNavigate();
	const { data: sites } = useSites();
	const { data: existingDomainNames } = useExistingCustomDomains();
	const { data: proposedName } = useProposedSiteName( sites );
	const createSite = useCreateSite();
	const [ submitError, setSubmitError ] = useState( '' );

	const handleSubmit = async ( values: CreateSiteFormValues ) => {
		setSubmitError( '' );
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
			} );
			await navigate( { to: '/sites/$siteId', params: { siteId: site.id } } );
		} catch ( error ) {
			setSubmitError(
				error instanceof Error ? error.message : __( 'Failed to create site. Please try again.' )
			);
		}
	};

	return (
		<OnboardingLayout onClose={ () => void navigate( { to: '/' } ) }>
			<div className={ styles.page }>
				<h1 className={ styles.title }>{ __( 'Create a new site' ) }</h1>
				<p className={ styles.subtitle }>
					{ __( 'Choose a name and we\u2019ll scaffold a fresh WordPress site locally.' ) }
				</p>
				<CreateSiteForm
					initialValues={ proposedName ? { name: proposedName } : undefined }
					existingDomainNames={ existingDomainNames ?? [] }
					onSubmit={ handleSubmit }
					onCancel={ () => void navigate( { to: '/onboarding' } ) }
					isSubmitting={ createSite.isPending }
					submitError={ submitError }
				/>
			</div>
		</OnboardingLayout>
	);
}

export function DeskOnboardingBlueprint() {
	const { step } = desksOnboardingBlueprintRoute.useSearch() as StepSearch;
	const navigate = useDesksNavigate();
	const activeStep: Step = step === 'configure' ? 'configure' : 'select';
	const featured = useFeaturedBlueprints();
	const { data: existingDomainNames } = useExistingCustomDomains();
	const createSite = useCreateSite();
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

	const handleSubmit = async ( values: CreateSiteFormValues ) => {
		if ( ! picked ) return;
		setSubmitError( '' );
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
			await navigate( { to: '/sites/$siteId', params: { siteId: site.id } } );
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
			<OnboardingLayout onClose={ () => void navigate( { to: '/' } ) } width="wide">
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
			</OnboardingLayout>
		);
	}

	if ( ! picked ) {
		return null;
	}

	const initialValues = mapBlueprintSettingsToFormValues(
		extractFormValuesFromBlueprint( picked.blueprint ),
		picked.title
	);

	return (
		<OnboardingLayout onClose={ () => void navigate( { to: '/' } ) }>
			<div className={ styles.page }>
				<Button
					type="button"
					variant="minimal"
					tone="neutral"
					className={ styles.backLink }
					onClick={ () =>
						void navigate( { to: '/onboarding/blueprint', search: { step: 'select' } } )
					}
				>
					<Icon icon={ arrowLeft } />
					<span>{ __( 'Back to Blueprints' ) }</span>
				</Button>
				<h1 className={ styles.title }>{ picked.title }</h1>
				{ picked.excerpt && <p className={ styles.subtitle }>{ picked.excerpt }</p> }
				<CreateSiteForm
					initialValues={ initialValues }
					existingDomainNames={ existingDomainNames ?? [] }
					onSubmit={ handleSubmit }
					onCancel={ () => void navigate( { to: '/onboarding' } ) }
					isSubmitting={ createSite.isPending }
					submitError={ submitError }
					submitLabel={ __( 'Create site from Blueprint' ) }
				/>
			</div>
		</OnboardingLayout>
	);
}

export function DeskOnboardingImport() {
	const { step } = desksOnboardingImportRoute.useSearch() as StepSearch;
	const navigate = useDesksNavigate();
	const connector = useConnector();
	const activeStep: Step = step === 'configure' ? 'configure' : 'select';
	const { data: existingDomainNames } = useExistingCustomDomains();
	const createSite = useCreateSite();
	const importSite = useImportSite();
	const [ picked, setPicked ] = useState< PickedBackup | null >( null );
	const [ pickError, setPickError ] = useState< string | null >( null );
	const [ submitError, setSubmitError ] = useState( '' );

	useEffect( () => {
		if ( activeStep === 'configure' && ! picked ) {
			void navigate( {
				to: '/onboarding/import',
				search: { step: 'select' },
				replace: true,
			} );
		}
	}, [ activeStep, picked, navigate ] );

	const handlePick = useCallback(
		async ( file: File ) => {
			if ( ! isValidBackupFile( file ) ) {
				setPickError(
					__(
						'This file type is not supported. Please use a .zip, .gz, .tar, .tar.gz, or .wpress file.'
					)
				);
				return;
			}
			const path = await connector.getFilePath( file );
			if ( ! path ) {
				setPickError(
					__( 'Unable to resolve the backup file path. Try choosing the file via the button.' )
				);
				return;
			}
			flushSync( () => {
				setPickError( null );
				setPicked( { file, path } );
			} );
			void navigate( {
				to: '/onboarding/import',
				search: { step: 'configure' },
			} );
		},
		[ connector, navigate ]
	);

	const handleClearPick = useCallback( () => {
		setPicked( null );
		setPickError( null );
	}, [] );

	const handleSubmit = async ( values: CreateSiteFormValues ) => {
		if ( ! picked ) return;
		setSubmitError( '' );
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
			} );
			await importSite.mutateAsync( {
				siteId: site.id,
				backup: { path: picked.path, type: picked.file.type },
			} );
			await navigate( { to: '/sites/$siteId', params: { siteId: site.id } } );
		} catch ( error ) {
			setSubmitError(
				error instanceof Error ? error.message : __( 'Failed to import site. Please try again.' )
			);
		}
	};

	if ( activeStep === 'select' ) {
		return (
			<OnboardingLayout onClose={ () => void navigate( { to: '/' } ) }>
				<div className={ styles.page }>
					<h1 className={ styles.title }>{ __( 'Import from a backup' ) }</h1>
					<p className={ styles.subtitle }>
						{ __(
							'Drop a backup archive to restore a site locally. Jetpack, All-in-One WP Migration, Local, and Playground exports are supported.'
						) }
					</p>
					<FileDropzone
						icon={ download }
						accept={ ACCEPTED_IMPORT_FILE_TYPES.join( ',' ) }
						prompt={ __( 'Drop a backup archive here, or' ) }
						onFile={ ( file ) => void handlePick( file ) }
						file={ picked?.file ?? null }
						onClear={ handleClearPick }
						error={ pickError }
					/>
				</div>
			</OnboardingLayout>
		);
	}

	if ( ! picked ) {
		return null;
	}

	const initialValues: Partial< CreateSiteFormValues > = {
		name: nameFromFilename( picked.file.name ),
	};
	const isSubmitting = createSite.isPending || importSite.isPending;

	return (
		<OnboardingLayout onClose={ () => void navigate( { to: '/' } ) }>
			<div className={ styles.page }>
				<Button
					type="button"
					variant="minimal"
					tone="neutral"
					className={ styles.backLink }
					onClick={ () =>
						void navigate( { to: '/onboarding/import', search: { step: 'select' } } )
					}
				>
					<Icon icon={ arrowLeft } />
					<span>{ __( 'Back to backup' ) }</span>
				</Button>
				<h1 className={ styles.title }>{ __( 'Configure the imported site' ) }</h1>
				<p className={ styles.subtitle }>
					{ __( 'Pick a name and local folder. The backup will restore on top of this new site.' ) }
				</p>
				<CreateSiteForm
					initialValues={ initialValues }
					existingDomainNames={ existingDomainNames ?? [] }
					onSubmit={ handleSubmit }
					onCancel={ () => void navigate( { to: '/onboarding' } ) }
					isSubmitting={ isSubmitting }
					submitError={ submitError }
					submitLabel={ __( 'Import site' ) }
				/>
			</div>
		</OnboardingLayout>
	);
}

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

function isValidBackupFile( file: File ): boolean {
	const lower = file.name.toLowerCase();
	return ACCEPTED_IMPORT_FILE_TYPES.some( ( ext ) => lower.endsWith( ext ) );
}

function nameFromFilename( filename: string ): string {
	const basename = filename.replace( /^.*[\\/]/, '' );
	const lower = basename.toLowerCase();
	const ext = ACCEPTED_IMPORT_FILE_TYPES.find( ( candidate ) => lower.endsWith( candidate ) );
	return ( ext ? basename.slice( 0, -ext.length ) : basename )
		.replace( /[-_](backup|export|wordpress|jetpack)(s)?$/i, '' )
		.replace( /[-_]\d{4}[-_]\d{2}[-_]\d{2}.*$/, '' )
		.replace( /[-_]+/g, ' ' )
		.trim();
}

function validateStepSearch( search: Record< string, unknown > ): StepSearch {
	const value = search.step;
	if ( value === 'configure' || value === 'select' ) {
		return { step: value };
	}
	return {};
}

export const desksOnboardingHomeRoute = createRoute( {
	getParentRoute: () => desksRootRoute,
	path: '/onboarding',
	component: DeskOnboardingHome,
} );

export const desksOnboardingCreateRoute = createRoute( {
	getParentRoute: () => desksRootRoute,
	path: '/onboarding/create',
	component: DeskOnboardingCreate,
} );

export const desksOnboardingBlueprintRoute = createRoute( {
	getParentRoute: () => desksRootRoute,
	path: '/onboarding/blueprint',
	validateSearch: validateStepSearch,
	component: DeskOnboardingBlueprint,
} );

export const desksOnboardingImportRoute = createRoute( {
	getParentRoute: () => desksRootRoute,
	path: '/onboarding/import',
	validateSearch: validateStepSearch,
	component: DeskOnboardingImport,
} );
