import { ACCEPTED_IMPORT_FILE_TYPES } from '@studio/common/constants';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { chevronLeft, download } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { CreateSiteForm } from '@/components/create-site-form';
import { FileDropzone } from '@/components/file-dropzone';
import { OnboardingFooter } from '@/components/onboarding-footer';
import { useConnector } from '@/data/core';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import { useImportSite } from '@/data/queries/use-import-site';
import { useCreateSite } from '@/data/queries/use-sites';
import { onboardingLayoutRoute } from '../layout-onboarding';
import sharedStyles from '../layout-onboarding/style.module.css';
import type { CreateSiteFormValues } from '@/components/create-site-form';

type Step = 'select' | 'configure';

interface ImportSearch {
	step?: Step;
}

interface PickedBackup {
	file: File;
	// Resolved from the connector once at pick-time so the submit handler
	// doesn't have to await the preload bridge again.
	path: string;
}

function isValidBackupFile( file: File ): boolean {
	const lower = file.name.toLowerCase();
	return ACCEPTED_IMPORT_FILE_TYPES.some( ( ext ) => lower.endsWith( ext ) );
}

/**
 * Derives a friendly default site name from a backup filename. Strips the
 * archive extension and common "site-backup-2024-01-01" date suffixes so the
 * form can seed the site name without the user having to retype it.
 */
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

function OnboardingImportPage() {
	const { step } = onboardingImportRoute.useSearch();
	const navigate = useNavigate();
	const connector = useConnector();
	const activeStep: Step = step === 'configure' ? 'configure' : 'select';

	const existingDomainNames = useExistingCustomDomains();
	const createSite = useCreateSite();
	const importSite = useImportSite();

	// Picked backup lives in component state — survives navigation between
	// steps but not a hard refresh. If the user lands on `step=configure`
	// with no picked backup, the effect below bounces them back to select.
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
			// `flushSync` commits the state updates before `navigate` fires so
			// the router's URL change and React's component state land in the
			// same render pass. Without this, tanstack router's store update
			// commits first, the component re-renders with `activeStep` already
			// at `configure` but `picked` still null, and the hard-refresh
			// guard effect below immediately bounces us back to `select`.
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

	const handleBackToSelect = useCallback( () => {
		void navigate( {
			to: '/onboarding/import',
			search: { step: 'select' },
		} );
	}, [ navigate ] );

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
			await navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
		} catch ( error ) {
			setSubmitError(
				error instanceof Error ? error.message : __( 'Failed to import site. Please try again.' )
			);
		}
	};

	if ( activeStep === 'select' ) {
		return (
			<div className={ sharedStyles.page }>
				<h1 className={ sharedStyles.title }>{ __( 'Import from a backup' ) }</h1>
				<p className={ sharedStyles.subtitle }>
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

	// `step=configure` with no picked backup is handled by the effect above;
	// render nothing in the intermediate frame to avoid a flash.
	if ( ! picked ) return null;

	const initialValues: Partial< CreateSiteFormValues > = {
		name: nameFromFilename( picked.file.name ),
	};
	const isSubmitting = createSite.isPending || importSite.isPending;

	return (
		<div className={ sharedStyles.page }>
			<h1 className={ sharedStyles.title }>{ __( 'Configure the imported site' ) }</h1>
			<p className={ sharedStyles.subtitle }>
				{ __( 'Pick a name and local folder. The backup will restore on top of this new site.' ) }
			</p>
			<CreateSiteForm
				initialValues={ initialValues }
				existingDomainNames={ existingDomainNames }
				onSubmit={ handleSubmit }
				onCancel={ handleBackToSelect }
				isSubmitting={ isSubmitting }
				submitError={ submitError }
				submitLabel={ __( 'Import site' ) }
			/>
		</div>
	);
}

export const onboardingImportRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/import',
	validateSearch: ( search: Record< string, unknown > ): ImportSearch => {
		const value = search.step;
		if ( value === 'configure' || value === 'select' ) {
			return { step: value };
		}
		return {};
	},
	component: OnboardingImportPage,
} );
