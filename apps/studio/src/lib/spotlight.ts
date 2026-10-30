import { app } from 'electron';
import { __, sprintf } from '@wordpress/i18n';
import { openDeeplink } from 'src/lib/deeplink';
import { buildStudioActionLink, parseStudioActionLink } from 'src/lib/deeplink/studio-action-link';
import { getSites } from 'src/lib/sites';
import { replaceSpotlightEntries } from 'src/lib/spotlight-native';

export function getSpotlightEntries( sites: { id: string; name: string }[] ) {
	const keywords = [ 'WordPress Studio', 'WordPress', 'Studio' ];
	return [
		{
			url: buildStudioActionLink( { action: 'new-site' } ),
			title: __( 'New WordPress Studio Site' ),
			description: 'WordPress Studio',
			keywords: [ ...keywords, __( 'New site' ), __( 'Create site' ) ],
		},
		...[ ...sites ]
			.sort( ( a, b ) => a.id.localeCompare( b.id ) )
			.map( ( site ) => ( {
				url: buildStudioActionLink( { action: 'open-site', siteId: site.id } ),
				// translators: %s is the name of a local WordPress site.
				title: sprintf( __( 'Open %s' ), site.name ),
				description: 'WordPress Studio',
				keywords: [ ...keywords, site.name, __( 'Open site' ) ],
			} ) ),
	];
}

let pending = Promise.resolve();
let indexedEntries: string | undefined;

export function refreshSpotlightIndex(): Promise< void > {
	// Development Electron bundles have a different identity and must not leave search results behind.
	if ( process.platform !== 'darwin' || ! app.isPackaged ) {
		return Promise.resolve();
	}
	const update = pending.then( async () => {
		const entries = JSON.stringify( getSpotlightEntries( await getSites() ) );
		if ( entries !== indexedEntries ) {
			await replaceSpotlightEntries( entries );
			indexedEntries = entries;
		}
	} );
	pending = update.catch( ( error ) =>
		console.warn( 'Could not update Spotlight entries:', error )
	);
	return pending;
}

export function setupSpotlight() {
	app.on( 'will-continue-activity', ( event, type ) => {
		if ( type === 'com.apple.corespotlightitem' ) {
			event.preventDefault();
		}
	} );
	app.on( 'continue-activity', ( event, type, userInfo ) => {
		if ( type !== 'com.apple.corespotlightitem' || ! userInfo || typeof userInfo !== 'object' ) {
			return;
		}
		const id = ( userInfo as Record< string, unknown > ).kCSSearchableItemActivityIdentifier;
		if ( typeof id === 'string' && parseStudioActionLink( id ) ) {
			event.preventDefault();
			openDeeplink( id );
		}
	} );
}
