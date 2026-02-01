import { select } from '@inquirer/prompts';
import { __, sprintf } from '@wordpress/i18n';
import wpcomFactory from 'src/lib/wpcom-factory';
import wpcomXhrRequest from 'src/lib/wpcom-xhr-request-factory';
import { z } from 'zod';
import {
	getAuthToken,
	lockAppdata,
	readAppdata,
	saveAppdata,
	unlockAppdata,
} from 'cli/lib/appdata';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

// Schema for WordPress.com site from /me/sites API
const wpcomSiteSchema = z.object( {
	ID: z.number(),
	name: z.string(),
	URL: z.string(),
	capabilities: z.record( z.boolean() ),
	is_deleted: z.boolean().optional(),
	plan: z
		.object( {
			features: z
				.object( {
					active: z.array( z.string() ),
				} )
				.optional(),
		} )
		.optional(),
	is_wpcom_atomic: z.boolean().optional(),
	options: z
		.object( {
			is_wpcom_staging_site: z.boolean().optional(),
			hosting_provider_guess: z.string().optional(),
			environment_type: z.string().optional(),
		} )
		.optional(),
} );

type WpcomSite = z.infer< typeof wpcomSiteSchema >;

function parseHostname( rawUrl: string | undefined ): string | null {
	if ( ! rawUrl ) {
		return null;
	}

	const trimmed = rawUrl.trim();
	if ( ! trimmed ) {
		return null;
	}

	const normalized = trimmed.includes( '://' ) ? trimmed : `https://${ trimmed }`;

	try {
		return new URL( normalized ).hostname.toLowerCase();
	} catch {
		return null;
	}
}

function hasHostnameSuffix( rawUrl: string | undefined, suffix: string ): boolean {
	const hostname = parseHostname( rawUrl );
	if ( ! hostname ) {
		return false;
	}

	const normalizedSuffix = suffix.replace( /^\./, '' ).toLowerCase();
	return hostname === normalizedSuffix || hostname.endsWith( `.${ normalizedSuffix }` );
}

async function fetchWpcomSites( token: string ): Promise< WpcomSite[] > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	return new Promise( ( resolve, reject ) => {
		void wpcom.req.get(
			{
				path: '/me/sites',
				apiNamespace: 'rest/v1.1',
			},
			( error: Error | null, data: unknown ) => {
				if ( error ) {
					return reject( error );
				}

				try {
					const result = z.object( { sites: z.array( wpcomSiteSchema ) } ).parse( data );
					resolve( result.sites );
				} catch ( validationError ) {
					reject( validationError );
				}
			}
		);
	} );
}

function getSyncSupport( site: WpcomSite ): { supported: boolean; reason?: string } {
	// Check if site is deleted
	if ( site.is_deleted ) {
		return { supported: false, reason: __( 'Site is deleted' ) };
	}

	// Check manage_options capability
	if ( ! site.capabilities?.manage_options ) {
		return { supported: false, reason: __( 'Missing manage_options permission' ) };
	}

	// Check for studio-sync feature in plan
	const features = site.plan?.features?.active || [];
	if ( ! features.includes( 'studio-sync' ) ) {
		return { supported: false, reason: __( 'Plan does not include sync feature' ) };
	}

	// Must be Atomic or Pressable
	const isPressable =
		site.options?.hosting_provider_guess === 'pressable' ||
		site.options?.hosting_provider_guess === 'pressable-free-staging' ||
		hasHostnameSuffix( site.URL, 'mystagingwebsite.com' );

	if ( ! site.is_wpcom_atomic && ! isPressable ) {
		return { supported: false, reason: __( 'Site must be Atomic or Pressable' ) };
	}

	return { supported: true };
}

export async function runCommand( localSiteId: string, remoteSiteId?: string ): Promise< void > {
	const logger = new Logger();

	try {
		// Get auth token
		let token: Awaited< ReturnType< typeof getAuthToken > >;
		try {
			token = await getAuthToken();
		} catch {
			logger.reportError(
				new LoggerError(
					__(
						'Authentication required. Please log in to WordPress.com first:\n\n  studio auth login'
					)
				)
			);
			return;
		}

		// Load appdata
		const appdata = await readAppdata();

		// Find the local site
		const localSite = appdata.sites.find( ( site ) => site.id === localSiteId );
		if ( ! localSite ) {
			logger.reportError(
				new LoggerError( sprintf( __( 'Local site "%s" not found' ), localSiteId ) )
			);
			console.log( __( '\nUse "studio site list" to see available sites' ) );
			return;
		}

		// Fetch WordPress.com sites
		logger.reportStart( undefined, __( 'Fetching WordPress.com sites…' ) );
		const wpcomSites = await fetchWpcomSites( token.accessToken );
		logger.spinner.stop();

		// Filter for syncable sites not already connected to this local site
		const connectedSites = appdata.connectedWpcomSites?.[ token.id ] || [];
		const alreadyConnectedIds = connectedSites
			.filter( ( site ) => site.localSiteId === localSiteId )
			.map( ( site ) => site.id );

		const syncableSites = wpcomSites
			.map( ( site ) => {
				const support = getSyncSupport( site );
				return { site, support };
			} )
			.filter(
				( { site, support } ) => support.supported && ! alreadyConnectedIds.includes( site.ID )
			);

		if ( syncableSites.length === 0 ) {
			logger.reportWarning( __( 'No syncable WordPress.com sites found' ) );
			console.log(
				__(
					'\nTo sync with WordPress.com, you need an Atomic or Pressable site with the studio-sync feature.'
				)
			);
			return;
		}

		// Select site (either from argument or prompt)
		let selectedSite: WpcomSite;

		if ( remoteSiteId ) {
			const found = syncableSites.find(
				( { site } ) =>
					site.ID === parseInt( remoteSiteId, 10 ) || site.URL.includes( remoteSiteId )
			);
			if ( ! found ) {
				logger.reportError(
					new LoggerError(
						sprintf( __( 'Remote site "%s" not found or not syncable' ), remoteSiteId )
					)
				);
				return;
			}
			selectedSite = found.site;
		} else {
			// Interactive selection
			const answer = await select( {
				message: __( 'Select a WordPress.com site to connect:' ),
				choices: syncableSites.map( ( { site } ) => ( {
					name: `${ site.name } (${ site.URL })`,
					value: site.ID,
				} ) ),
			} );

			const found = syncableSites.find( ( { site } ) => site.ID === answer );
			if ( ! found ) {
				throw new Error( __( 'Site selection failed' ) );
			}
			selectedSite = found.site;
		}

		// Save the connection
		logger.reportStart( undefined, __( 'Connecting sites…' ) );

		await lockAppdata();
		try {
			const updatedAppdata = await readAppdata();

			if ( ! updatedAppdata.connectedWpcomSites ) {
				updatedAppdata.connectedWpcomSites = {};
			}
			if ( ! updatedAppdata.connectedWpcomSites[ token.id ] ) {
				updatedAppdata.connectedWpcomSites[ token.id ] = [];
			}

			const isPressable =
				selectedSite.options?.hosting_provider_guess === 'pressable' ||
				selectedSite.options?.hosting_provider_guess === 'pressable-free-staging' ||
				hasHostnameSuffix( selectedSite.URL, 'mystagingwebsite.com' );

			updatedAppdata.connectedWpcomSites[ token.id ].push( {
				id: selectedSite.ID,
				localSiteId,
				name: selectedSite.name,
				url: selectedSite.URL,
				isStaging: selectedSite.options?.is_wpcom_staging_site || false,
				isPressable,
				environmentType: selectedSite.options?.environment_type || null,
				syncSupport: 'syncable',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			} );

			await saveAppdata( updatedAppdata );

			logger.reportSuccess(
				sprintf(
					__( 'Successfully connected "%s" to "%s"' ),
					localSite.name || localSiteId,
					selectedSite.name
				)
			);
		} finally {
			await unlockAppdata();
		}
	} catch ( error ) {
		logger.spinner.stop();
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else if ( error instanceof z.ZodError ) {
			logger.reportError( new LoggerError( __( 'Invalid response from WordPress.com' ), error ) );
		} else {
			logger.reportError( new LoggerError( __( 'Failed to connect sites' ), error ) );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'connect <local-site-id> [remote-site-id]',
		describe: __( 'Connect a local site to a WordPress.com site' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'local-site-id', {
					describe: __( 'ID of the local site' ),
					type: 'string',
					demandOption: true,
				} )
				.positional( 'remote-site-id', {
					describe: __(
						'ID or URL of the remote WordPress.com site (optional, will prompt if not provided)'
					),
					type: 'string',
				} )
				.option( 'path', {
					hidden: true,
				} );
		},
		handler: async ( argv ) => {
			await runCommand(
				argv[ 'local-site-id' ] as string,
				argv[ 'remote-site-id' ] as string | undefined
			);
		},
	} );
};
