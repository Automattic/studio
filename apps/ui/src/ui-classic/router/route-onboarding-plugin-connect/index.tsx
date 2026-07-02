import { createRoute, useNavigate } from '@tanstack/react-router';
import { speak } from '@wordpress/a11y';
import { Spinner } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { chevronLeft } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useState } from 'react';
import { BusyOverlay } from '@/components/busy-overlay';
import { OnboardingFooter } from '@/components/onboarding-footer';
import { useFindAvailableSiteName } from '@/data/queries/use-create-site-helpers';
import { useCreateSite } from '@/data/queries/use-sites';
import { useWporgAuthorPlugins } from '@/data/queries/use-wporg-plugins';
import { useGridArrowNavigation } from '@/hooks/use-grid-arrow-navigation';
import { tagSiteAsPlugin } from '@/lib/plugin-prototype';
import { onboardingLayoutRoute } from '../layout-onboarding';
import sharedStyles from '../layout-onboarding/style.module.css';
import styles from './style.module.css';
import type { WporgPlugin } from '@/data/queries/use-wporg-plugins';

// Simulated: the real flow would log into WordPress.org and list plugins
// the account can commit to (see the plugin-development reference PR). Until
// that plumbing exists here, we pretend this account is already connected
// and show real directory data for a stand-in username.
const SIMULATED_USERNAME = 'automattic';

function formatActiveInstalls( count: number ): string {
	if ( count <= 0 ) {
		return '';
	}
	return sprintf(
		// translators: %s is a formatted number of active installs, e.g. "5,000,000".
		__( '%s+ active installs' ),
		count.toLocaleString()
	);
}

function PluginCard( {
	plugin,
	isSelected,
	onSelect,
}: {
	plugin: WporgPlugin;
	isSelected: boolean;
	onSelect: ( slug: string ) => void;
} ) {
	return (
		<li>
			<button
				type="button"
				className={
					isSelected ? `${ styles.pluginCard } ${ styles.pluginCardSelected }` : styles.pluginCard
				}
				aria-pressed={ isSelected }
				data-arrow-nav-item
				onClick={ () => onSelect( plugin.slug ) }
			>
				<span className={ styles.pluginIcon }>
					{ plugin.icon && <img src={ plugin.icon } alt="" loading="lazy" /> }
				</span>
				<span className={ styles.pluginText }>
					<span className={ styles.pluginName }>{ plugin.name }</span>
					<span className={ styles.pluginMeta }>
						{ [ formatActiveInstalls( plugin.activeInstalls ), plugin.slug ]
							.filter( Boolean )
							.join( ' · ' ) }
					</span>
				</span>
			</button>
		</li>
	);
}

function PluginConnectPage() {
	const navigate = useNavigate();
	const handleGridKeyDown = useGridArrowNavigation();
	const { data: plugins = [], isLoading, isError } = useWporgAuthorPlugins( SIMULATED_USERNAME );
	const [ selectedSlug, setSelectedSlug ] = useState< string | null >( null );
	const [ submitError, setSubmitError ] = useState( '' );
	const createSite = useCreateSite();
	const findAvailableSiteName = useFindAvailableSiteName();

	const selectedPlugin = plugins.find( ( plugin ) => plugin.slug === selectedSlug );

	// Plugins are just sites with extra presentation: create a real local
	// site named after the plugin (so status, chat, and preview all work),
	// then tag it for the sidebar prototype. The real flow would also check
	// out the plugin's SVN repo into it.
	const handleAdd = async () => {
		if ( ! selectedPlugin || createSite.isPending ) {
			return;
		}
		setSubmitError( '' );
		try {
			const { name: availableName, path: sitePath } = await findAvailableSiteName(
				selectedPlugin.name
			);
			const site = await createSite.mutateAsync( { name: availableName, path: sitePath } );
			tagSiteAsPlugin( {
				siteId: site.id,
				slug: selectedPlugin.slug,
				source: 'wporg',
			} );
			speak(
				sprintf(
					// translators: %s is the plugin name.
					__( '%s plugin added.' ),
					selectedPlugin.name
				)
			);
			await navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
		} catch ( error ) {
			setSubmitError(
				error instanceof Error ? error.message : __( 'Failed to add plugin. Please try again.' )
			);
		}
	};

	return (
		<div className={ `${ sharedStyles.page } ${ sharedStyles.pageSpacious }` }>
			<BusyOverlay active={ createSite.isPending } />
			<h1 className={ sharedStyles.title }>{ __( 'Connect to WordPress.org' ) }</h1>
			<p className={ sharedStyles.subtitle }>
				{ __(
					'Select a plugin you contribute to and Studio will set it up for local development.'
				) }
			</p>

			<p className={ styles.connectedHint }>
				{ sprintf(
					// translators: %s is a WordPress.org username.
					__( 'Connected as %s' ),
					SIMULATED_USERNAME
				) }
			</p>

			{ isLoading && (
				<div className={ styles.loadingState }>
					<Spinner />
					<p className={ styles.listHint }>{ __( 'Loading your plugins…' ) }</p>
				</div>
			) }
			{ isError && (
				<p role="alert" className={ styles.listHint }>
					{ __( 'Could not load plugins from WordPress.org. Please try again.' ) }
				</p>
			) }
			{ ! isLoading && ! isError && plugins.length === 0 && (
				<p className={ styles.listHint }>
					{ __( 'No plugins found for this WordPress.org account.' ) }
				</p>
			) }

			{ plugins.length > 0 && (
				<ul className={ styles.pluginGrid } onKeyDown={ handleGridKeyDown }>
					{ plugins.map( ( plugin ) => (
						<PluginCard
							key={ plugin.slug }
							plugin={ plugin }
							isSelected={ selectedSlug === plugin.slug }
							onSelect={ setSelectedSlug }
						/>
					) ) }
				</ul>
			) }

			{ submitError && (
				<div role="alert" className={ styles.submitError }>
					{ submitError }
				</div>
			) }

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
					type="button"
					variant="solid"
					tone="brand"
					disabled={ ! selectedPlugin || createSite.isPending }
					loading={ createSite.isPending }
					loadingAnnouncement={ __( 'Adding plugin' ) }
					onClick={ () => void handleAdd() }
					data-testid="connect-plugin-submit"
				>
					{ __( 'Add plugin' ) }
				</Button>
			</OnboardingFooter>
		</div>
	);
}

export const onboardingPluginConnectRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/plugin/connect',
	component: PluginConnectPage,
} );
