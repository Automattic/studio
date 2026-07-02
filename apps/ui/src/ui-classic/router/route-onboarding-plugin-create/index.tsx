import { createRoute, useNavigate } from '@tanstack/react-router';
import { speak } from '@wordpress/a11y';
import { TextareaControl } from '@wordpress/components';
import { DataForm, useFormValidity } from '@wordpress/dataviews';
import { __, sprintf } from '@wordpress/i18n';
import { chevronDown, chevronLeft, chevronRight } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useState } from 'react';
import { BusyOverlay } from '@/components/busy-overlay';
import { OnboardingFooter } from '@/components/onboarding-footer';
import { useConnector } from '@/data/core';
import { useFindAvailableSiteName } from '@/data/queries/use-create-site-helpers';
import { useCreateSite } from '@/data/queries/use-sites';
import { setPendingSessionPrompt } from '@/lib/pending-session-prompt';
import { tagSiteAsPlugin } from '@/lib/plugin-prototype';
import { onboardingLayoutRoute } from '../layout-onboarding';
import sharedStyles from '../layout-onboarding/style.module.css';
import styles from './style.module.css';
import type { DataFormControlProps, Field, Form } from '@wordpress/dataviews';
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

// The description doubles as the agent's build brief, so it can run long —
// but the plugin header's Description line should stay a short sentence.
function toHeaderDescription( value: string ): string {
	const firstLine = value.split( /\r?\n/ )[ 0 ].trim();
	return firstLine.length > 140 ? `${ firstLine.slice( 0, 137 ).trimEnd() }…` : firstLine;
}

function buildInitialBuildPrompt( pluginName: string, slug: string, description: string ): string {
	return [
		`I just created a new WordPress plugin called "${ pluginName }" (slug \`${ slug }\`). A scaffold already exists at wp-content/plugins/${ slug }/ and the plugin is activated on this site.`,
		'Here is what the plugin should do:',
		description,
		'Build the initial version of the plugin based on that description, keeping the code inside the existing plugin folder. When you are done, briefly explain what you built and how I can try it.',
	].join( '\n\n' );
}

// Multiline control for the description — it doubles as the brief the AI
// uses to build the first version, so give it room.
function DescriptionControl( {
	data: item,
	field,
	hideLabelFromVision,
	onChange,
}: DataFormControlProps< PluginFormData > ) {
	return (
		<TextareaControl
			__nextHasNoMarginBottom
			label={ field.label }
			hideLabelFromVision={ hideLabelFromVision }
			rows={ 5 }
			value={ item.description }
			onChange={ ( value ) => onChange( { description: value } ) }
			help={ __(
				'Describe what your plugin should do — after scaffolding, the AI builds the first version from this.'
			) }
		/>
	);
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
		Edit: DescriptionControl,
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
	// Covers the whole create + scaffold sequence, not just the site mutation.
	const [ isSubmitting, setIsSubmitting ] = useState( false );
	const connector = useConnector();
	const createSite = useCreateSite();
	const findAvailableSiteName = useFindAvailableSiteName();
	const slug = toSlug( data.name );

	const handleChange = ( update: Record< string, unknown > ) => {
		setData( ( prev ) => ( { ...prev, ...( update as Partial< PluginFormData > ) } ) );
	};

	// Plugins are just sites with extra presentation: create a real local
	// site (so status, chat, and preview all work), scaffold the plugin into
	// it (files + wp-cli activation), then tag it for the sidebar. The
	// existing-folder mode is still simulated — no files are copied yet.
	const handleSubmit = async ( event: FormEvent ) => {
		event.preventDefault();
		if ( ! isValid || isSubmitting ) {
			return;
		}
		setSubmitError( '' );
		setIsSubmitting( true );
		const pluginName = data.name.trim();
		let site;
		try {
			const { name: availableName, path: sitePath } = await findAvailableSiteName( pluginName );
			site = await createSite.mutateAsync( { name: availableName, path: sitePath } );
		} catch ( error ) {
			setIsSubmitting( false );
			setSubmitError(
				error instanceof Error ? error.message : __( 'Failed to create plugin. Please try again.' )
			);
			return;
		}
		if ( ! isExisting ) {
			try {
				await connector.scaffoldPlugin( site.id, {
					slug,
					name: pluginName,
					description: toHeaderDescription( data.description ),
					author: data.author.trim(),
					version: data.version.trim(),
					pluginUri: data.pluginUri.trim(),
					authorUri: data.authorUri.trim(),
					license: data.license.trim(),
				} );
			} catch ( error ) {
				// The site exists but the plugin doesn't — leave it untagged (a
				// plain site the user can delete) and surface the failure.
				setIsSubmitting( false );
				setSubmitError(
					sprintf(
						// translators: %s is an error message.
						__( 'The site was created, but the plugin could not be scaffolded: %s' ),
						error instanceof Error ? error.message : String( error )
					)
				);
				return;
			}
		}
		tagSiteAsPlugin( {
			siteId: site.id,
			slug,
			source: isExisting ? 'folder' : 'new',
			path,
		} );
		// Hand the full description to the agent: the session view we're about
		// to land on picks this up and auto-sends it, so the AI builds the
		// first version of the plugin from the user's brief.
		const description = data.description.trim();
		if ( ! isExisting && description ) {
			setPendingSessionPrompt( {
				siteId: site.id,
				prompt: buildInitialBuildPrompt( pluginName, slug, description ),
			} );
		}
		speak(
			sprintf(
				// translators: %s is the plugin name.
				__( '%s plugin added.' ),
				pluginName
			)
		);
		await navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
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
				{ /* Creating the site and scaffolding take a moment; shield the
				     window so stray clicks can't interrupt mid-flight. */ }
				<BusyOverlay active={ isSubmitting } />
				<div className={ styles.panel } inert={ isSubmitting || undefined }>
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
						disabled={ isSubmitting }
					>
						<Icon icon={ chevronLeft } size={ 16 } />
						<span>{ __( 'Back' ) }</span>
					</Button>
					<Button
						type="submit"
						variant="solid"
						tone="brand"
						disabled={ ! isValid || isSubmitting }
						loading={ isSubmitting }
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
