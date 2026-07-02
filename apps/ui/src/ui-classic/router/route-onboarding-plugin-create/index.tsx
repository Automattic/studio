import { createRoute, useNavigate } from '@tanstack/react-router';
import { speak } from '@wordpress/a11y';
import { DataForm, useFormValidity } from '@wordpress/dataviews';
import { __, sprintf } from '@wordpress/i18n';
import { chevronDown, chevronLeft, chevronRight } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useState } from 'react';
import { BusyOverlay } from '@/components/busy-overlay';
import { OnboardingFooter } from '@/components/onboarding-footer';
import { useFindAvailableSiteName } from '@/data/queries/use-create-site-helpers';
import { useCreateSite } from '@/data/queries/use-sites';
import { tagSiteAsPlugin } from '@/lib/plugin-prototype';
import { onboardingLayoutRoute } from '../layout-onboarding';
import sharedStyles from '../layout-onboarding/style.module.css';
import styles from './style.module.css';
import type { Field, Form } from '@wordpress/dataviews';
import type { FormEvent } from 'react';

/**
 * Field set follows the plugin header spec (Plugin Handbook: only "Plugin
 * Name" is required; everything else is optional metadata). The basics are
 * what every plugin should ship; the advanced group covers the remaining
 * header fields a scaffold can't infer. Text Domain is not asked for —
 * it should always match the slug, which is derived from the name.
 */
interface PluginFormData {
	name: string;
	description: string;
	author: string;
	version: string;
	pluginUri: string;
	authorUri: string;
	license: string;
}

interface PluginCreateSearch {
	// Present when arriving from the "Add an existing plugin" folder picker;
	// switches the form into configure-existing mode.
	path?: string;
	name?: string;
}

function toSlug( value: string ): string {
	return value
		.toLowerCase()
		.trim()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' );
}

const BASIC_FORM: Form = {
	layout: { type: 'regular', labelPosition: 'top' },
	fields: [ 'name', 'description', 'author' ],
};

const ADVANCED_FORM: Form = {
	layout: { type: 'regular', labelPosition: 'top' },
	fields: [ 'version', 'pluginUri', 'authorUri', 'license' ],
};

// Covers both sections so validity accounts for fields that aren't mounted
// while the Advanced group is collapsed.
const FULL_FORM: Form = {
	layout: { type: 'regular', labelPosition: 'top' },
	fields: [ ...BASIC_FORM.fields!, ...ADVANCED_FORM.fields! ],
};

const FIELDS: Field< PluginFormData >[] = [
	{
		id: 'name',
		type: 'text',
		label: __( 'Plugin name' ),
		isValid: { required: true },
	},
	{
		id: 'description',
		type: 'text',
		label: __( 'Description' ),
		description: __(
			'A short sentence shown in the Plugins screen. Keep it under 140 characters.'
		),
	},
	{
		id: 'author',
		type: 'text',
		label: __( 'Author' ),
	},
	{
		id: 'version',
		type: 'text',
		label: __( 'Version' ),
	},
	{
		id: 'pluginUri',
		type: 'text',
		label: __( 'Plugin URI' ),
		description: __( 'The plugin’s home page, if it has one.' ),
	},
	{
		id: 'authorUri',
		type: 'text',
		label: __( 'Author URI' ),
	},
	{
		id: 'license',
		type: 'text',
		label: __( 'License' ),
	},
];

function PluginCreatePage() {
	const navigate = useNavigate();
	const { path, name: folderName } = onboardingPluginCreateRoute.useSearch();
	const isExisting = Boolean( path );

	const [ data, setData ] = useState< PluginFormData >( {
		name: folderName ?? '',
		description: '',
		author: '',
		// Scaffolding defaults: pre-1.0 version (matching wp-cli and
		// create-block scaffolds) and WordPress's own license.
		version: '0.1.0',
		pluginUri: '',
		authorUri: '',
		license: 'GPLv2 or later',
	} );
	const { validity, isValid } = useFormValidity( data, FIELDS, FULL_FORM );
	const [ isAdvancedOpen, setIsAdvancedOpen ] = useState( false );
	const [ submitError, setSubmitError ] = useState( '' );
	const createSite = useCreateSite();
	const findAvailableSiteName = useFindAvailableSiteName();
	const slug = toSlug( data.name );

	const handleChange = ( update: Record< string, unknown > ) => {
		setData( ( prev ) => ( { ...prev, ...( update as Partial< PluginFormData > ) } ) );
	};

	// Plugins are just sites with extra presentation: create a real local
	// site (so status, chat, and preview all work), then tag it as a plugin
	// for the sidebar prototype. The plugin metadata itself (headers,
	// scaffold) isn't written anywhere yet.
	const handleSubmit = async ( event: FormEvent ) => {
		event.preventDefault();
		if ( ! isValid || createSite.isPending ) {
			return;
		}
		setSubmitError( '' );
		try {
			const pluginName = data.name.trim();
			const { name: availableName, path: sitePath } = await findAvailableSiteName( pluginName );
			const site = await createSite.mutateAsync( { name: availableName, path: sitePath } );
			tagSiteAsPlugin( {
				siteId: site.id,
				slug,
				source: isExisting ? 'folder' : 'new',
				path,
			} );
			speak(
				sprintf(
					// translators: %s is the plugin name.
					__( '%s plugin added.' ),
					pluginName
				)
			);
			await navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
		} catch ( error ) {
			setSubmitError(
				error instanceof Error ? error.message : __( 'Failed to create plugin. Please try again.' )
			);
		}
	};

	return (
		<div className={ sharedStyles.page }>
			<h1 className={ sharedStyles.title }>
				{ isExisting ? __( 'Add an existing plugin' ) : __( 'Create a new plugin' ) }
			</h1>
			<p className={ sharedStyles.subtitle }>
				{ isExisting
					? __( 'Tell us a little about the plugin in this folder.' )
					: __( 'Tell us a little about your plugin and we’ll scaffold it for you.' ) }
			</p>
			<form onSubmit={ ( event ) => void handleSubmit( event ) }>
				{ /* Creating the underlying site takes a moment; shield the window
				     so stray clicks can't interrupt mid-flight. */ }
				<BusyOverlay active={ createSite.isPending } />
				<div className={ styles.panel } inert={ createSite.isPending || undefined }>
					{ isExisting && (
						<div className={ styles.folderRow }>
							<span className={ styles.folderLabel }>{ __( 'Plugin folder' ) }</span>
							<span className={ styles.folderPath }>{ path }</span>
						</div>
					) }
					<DataForm< PluginFormData >
						data={ data }
						fields={ FIELDS }
						form={ BASIC_FORM }
						onChange={ handleChange }
						validity={ validity }
					/>
					{ slug && (
						<p className={ styles.slugPreview }>
							{ sprintf(
								// translators: %s is the plugin slug, e.g. "my-plugin".
								__( 'Plugin slug and text domain: %s' ),
								slug
							) }
						</p>
					) }

					<Button
						type="button"
						variant="unstyled"
						tone="neutral"
						className={ styles.advancedToggle }
						onClick={ () => setIsAdvancedOpen( ( value ) => ! value ) }
						aria-expanded={ isAdvancedOpen }
					>
						<Icon icon={ isAdvancedOpen ? chevronDown : chevronRight } />
						<span>{ __( 'Plugin details' ) }</span>
					</Button>

					<div
						className={
							isAdvancedOpen
								? `${ styles.advancedCollapse } ${ styles.advancedCollapseOpen }`
								: styles.advancedCollapse
						}
						inert={ ! isAdvancedOpen || undefined }
					>
						<div className={ styles.advancedCollapseInner }>
							<DataForm< PluginFormData >
								data={ data }
								fields={ FIELDS }
								form={ ADVANCED_FORM }
								onChange={ handleChange }
								validity={ validity }
							/>
						</div>
					</div>

					{ submitError && (
						<div role="alert" className={ styles.submitError }>
							{ submitError }
						</div>
					) }
				</div>
				<OnboardingFooter>
					<Button
						type="button"
						variant="minimal"
						tone="neutral"
						onClick={ () => void navigate( { to: '/onboarding/plugin' } ) }
						disabled={ createSite.isPending }
					>
						<Icon icon={ chevronLeft } size={ 16 } />
						<span>{ __( 'Back' ) }</span>
					</Button>
					<Button
						type="submit"
						variant="solid"
						tone="brand"
						disabled={ ! isValid || createSite.isPending }
						loading={ createSite.isPending }
						loadingAnnouncement={ __( 'Creating plugin' ) }
						data-testid="create-plugin-submit"
					>
						{ isExisting ? __( 'Add plugin' ) : __( 'Create plugin' ) }
					</Button>
				</OnboardingFooter>
			</form>
		</div>
	);
}

export const onboardingPluginCreateRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/plugin/create',
	component: PluginCreatePage,
	validateSearch: ( search: Record< string, unknown > ): PluginCreateSearch => ( {
		path: typeof search.path === 'string' ? search.path : undefined,
		name: typeof search.name === 'string' ? search.name : undefined,
	} ),
} );
