import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import {
	BuildNewSiteIllustration,
	ConnectSiteIllustration,
	DropBackupIllustration,
	illustrationHostClass,
} from '@/components/onboarding-illustrations';
import { useConnector } from '@/data/core';
import { useGridArrowNavigation } from '@/hooks/use-grid-arrow-navigation';
import { useOffline } from '@/hooks/use-offline';
import { onboardingLayoutRoute } from '../layout-onboarding';
import sharedStyles from '../layout-onboarding/style.module.css';
// The plugin picker reuses the site picker's card styles so the two screens
// can't drift apart visually.
import styles from '../route-onboarding-home/style.module.css';

const cardClass = `${ styles.card } ${ illustrationHostClass }`;

// TODO: The illustrations are borrowed from the site cards until the plugin
// flow gets its own art.

// Connecting requires WordPress.org, so the card is disabled offline —
// matching the "Connect a site" card on the site picker.
function ConnectDotOrgCard() {
	const isOffline = useOffline();
	return (
		<Link
			to="/onboarding/plugin/connect"
			className={ isOffline ? `${ cardClass } ${ styles.cardDisabled }` : cardClass }
			aria-disabled={ isOffline || undefined }
			data-arrow-nav-item
			onClick={ ( event ) => {
				if ( isOffline ) {
					event.preventDefault();
				}
			} }
		>
			<ConnectSiteIllustration />
			<div className={ styles.cardText }>
				<h3 className={ styles.cardTitle }>{ __( 'Connect to WordPress.org' ) }</h3>
				<p className={ styles.cardBody }>
					{ __( 'Work on a plugin you contribute to in the WordPress.org directory' ) }
				</p>
			</div>
		</Link>
	);
}

// Mirrors the site picker's import card: the OS picker opens straight from
// the card, and a chosen folder lands on the configure form with the folder
// handed over through search params.
function ExistingPluginCard() {
	const navigate = useNavigate();
	const connector = useConnector();
	const [ error, setError ] = useState< string | null >( null );

	const handlePickFolder = async () => {
		setError( null );
		try {
			const folder = await connector.selectSiteFolder( '' );
			if ( ! folder ) {
				return;
			}
			void navigate( {
				to: '/onboarding/plugin/create',
				search: { path: folder.path, name: folder.name },
			} );
		} catch {
			setError( __( 'Choosing a folder is not available here.' ) );
		}
	};

	return (
		<button
			type="button"
			className={ cardClass }
			data-arrow-nav-item
			onClick={ () => void handlePickFolder() }
		>
			<DropBackupIllustration />
			<div className={ styles.cardText }>
				<h3 className={ styles.cardTitle }>{ __( 'Add an existing plugin' ) }</h3>
				<p className={ styles.cardBody }>
					{ __( 'Choose a folder on your computer that contains a WordPress plugin' ) }
				</p>
				{ error && (
					<span role="alert" className={ styles.cardError }>
						{ error }
					</span>
				) }
			</div>
		</button>
	);
}

export function OnboardingPluginPage() {
	const handleGridKeyDown = useGridArrowNavigation();
	return (
		<div className={ styles.page }>
			<h1 className={ sharedStyles.title }>{ __( 'Add a plugin' ) }</h1>
			<p className={ sharedStyles.subtitle }>
				{ __( 'Start a new plugin or work on one you already have.' ) }
			</p>
			<div className={ styles.cards } onKeyDown={ handleGridKeyDown }>
				<Link to="/onboarding/plugin/create" className={ cardClass } data-arrow-nav-item>
					<BuildNewSiteIllustration />
					<div className={ styles.cardText }>
						<h3 className={ styles.cardTitle }>{ __( 'Create a new plugin' ) }</h3>
						<p className={ styles.cardBody }>
							{ __( 'Start from scratch with a fresh plugin scaffold' ) }
						</p>
					</div>
				</Link>
				<ConnectDotOrgCard />
				<ExistingPluginCard />
			</div>
		</div>
	);
}

export const onboardingPluginRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/plugin',
	component: OnboardingPluginPage,
} );
