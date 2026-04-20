import { createRoute, Link, Outlet, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { CreateSiteForm } from '@/components/create-site-form';
import { OnboardingLayout } from '@/components/onboarding-layout';
import {
	useExistingCustomDomains,
	useProposedSiteName,
} from '@/data/queries/use-create-site-helpers';
import { useSites, useCreateSite } from '@/data/queries/use-sites';
import styles from './onboarding.module.css';
import { rootRoute } from './root';
import type { CreateSiteFormValues } from '@/components/create-site-form';

function OnboardingShell() {
	const navigate = useNavigate();
	const { data: sites } = useSites();
	const hasSites = ( sites?.length ?? 0 ) > 0;
	return (
		<OnboardingLayout
			onClose={ hasSites ? () => void navigate( { to: '/dashboard' } ) : undefined }
		>
			<Outlet />
		</OnboardingLayout>
	);
}

const onboardingLayoutRoute = createRoute( {
	getParentRoute: () => rootRoute,
	id: 'onboarding-layout',
	component: OnboardingShell,
} );

function OnboardingIndex() {
	return (
		<div className={ styles.page }>
			<h1 className={ styles.title }>{ __( 'Start a new site' ) }</h1>
			<p className={ styles.subtitle }>
				{ __( 'WordPress can power anything. What are you building?' ) }
			</p>
			<div className={ styles.cards }>
				<Link to="/onboarding/create" className={ styles.card }>
					<h3 className={ styles.cardTitle }>{ __( 'Create new' ) }</h3>
					<p className={ styles.cardBody }>
						{ __( 'Start fresh with a blank site and build it with AI' ) }
					</p>
				</Link>
				<div className={ `${ styles.card } ${ styles.cardDisabled }` }>
					<h3 className={ styles.cardTitle }>{ __( 'Bring existing' ) }</h3>
					<p className={ styles.cardBody }>
						{ __( 'Import from WordPress.com, a backup, or an export file' ) }
					</p>
					<span className={ styles.cardBadge }>{ __( 'Coming soon' ) }</span>
				</div>
			</div>
		</div>
	);
}

function CreateSitePage() {
	const navigate = useNavigate();
	const { data: sites } = useSites();
	const { data: existingDomainNames } = useExistingCustomDomains();
	const { data: proposedName } = useProposedSiteName( sites );
	const createSite = useCreateSite();
	const [ submitError, setSubmitError ] = useState( '' );

	const handleSubmit = async ( values: CreateSiteFormValues ) => {
		setSubmitError( '' );
		try {
			await createSite.mutateAsync( {
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
			await navigate( { to: '/dashboard' } );
		} catch ( error ) {
			setSubmitError(
				error instanceof Error ? error.message : __( 'Failed to create site. Please try again.' )
			);
		}
	};

	return (
		<div className={ styles.page }>
			<h1 className={ styles.title }>{ __( 'Create a new site' ) }</h1>
			<p className={ styles.subtitle }>
				{ __( 'Choose a name and we\u2019ll scaffold a fresh WordPress site locally.' ) }
			</p>
			<CreateSiteForm
				defaultName={ proposedName }
				existingDomainNames={ existingDomainNames ?? [] }
				onSubmit={ handleSubmit }
				onCancel={ () => void navigate( { to: '/onboarding' } ) }
				isSubmitting={ createSite.isPending }
				submitError={ submitError }
			/>
		</div>
	);
}

const onboardingIndexRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding',
	component: OnboardingIndex,
} );

const onboardingCreateRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/create',
	component: CreateSitePage,
} );

export const onboardingRoute = onboardingLayoutRoute.addChildren( [
	onboardingIndexRoute,
	onboardingCreateRoute,
] );
