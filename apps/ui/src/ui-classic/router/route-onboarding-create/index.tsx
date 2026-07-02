import { createRoute, useNavigate } from '@tanstack/react-router';
import { speak } from '@wordpress/a11y';
import { __, sprintf } from '@wordpress/i18n';
import { useState } from 'react';
import { CreateSiteForm } from '@/components/create-site-form';
import {
	useExistingCustomDomains,
	useProposedSiteName,
} from '@/data/queries/use-create-site-helpers';
import { useCreateSite, useSites } from '@/data/queries/use-sites';
import { onboardingLayoutRoute } from '../layout-onboarding';
import styles from '../layout-onboarding/style.module.css';
import type { CreateSiteFormValues } from '@/components/create-site-form';

function CreateSitePage() {
	const navigate = useNavigate();
	const { data: sites } = useSites();
	const existingDomainNames = useExistingCustomDomains();
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
			speak(
				sprintf(
					// translators: %s is the site name.
					__( '%s site added.' ),
					values.name
				)
			);
			await navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
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
				initialValues={ proposedName ? { name: proposedName } : undefined }
				existingDomainNames={ existingDomainNames }
				onSubmit={ handleSubmit }
				onCancel={ () => void navigate( { to: '/onboarding/blueprint' } ) }
				isSubmitting={ createSite.isPending }
				submitError={ submitError }
			/>
		</div>
	);
}

export const onboardingCreateRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/create',
	component: CreateSitePage,
} );
