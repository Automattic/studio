import { readAuthToken, type StoredAuthToken } from '@studio/common/lib/shared-config';
import { __ } from '@wordpress/i18n';
import { enableReprintExporter, type ReprintExporterStatus } from 'cli/lib/api';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import { getSyncSupportError, pickSyncSite } from 'cli/lib/sync-site-picker';
import { LoggerError } from 'cli/logger';
import type { SyncSite } from '@studio/common/types/sync';

/** The remote site to pull from, and what the pull needs to reach it. */
export interface PullSource {
	exporter: ReprintExporterStatus;
	url: string;
	wpComSite: SyncSite;
	wpComToken: StoredAuthToken;
}

export function normalizeSiteUrl( url: string ): string {
	const trimmedUrl = url.trim();
	const normalized = new URL(
		/^[a-z][a-z\d+.-]*:\/\//i.test( trimmedUrl ) ? trimmedUrl : `https://${ trimmedUrl }`
	);
	normalized.hash = '';
	normalized.pathname = normalized.pathname.replace( /\/+$/, '' ) || '/';
	normalized.searchParams.delete( 'reprint-api-jetpack' );
	return normalized.toString();
}

/** Finds the site matching `url`, by full URL first and then by host. */
function findMatchingWpComSite< T extends { url: string } >(
	sites: T[],
	url: string
): T | undefined {
	const normalizedUrl = normalizeSiteUrl( url );
	const target = new URL( normalizedUrl );

	return sites.find( ( site ) => {
		try {
			const normalizedSiteUrl = normalizeSiteUrl( site.url );
			if ( normalizedSiteUrl === normalizedUrl ) {
				return true;
			}

			return new URL( normalizedSiteUrl ).host === target.host;
		} catch {
			return false;
		}
	} );
}

/**
 * Picks the WordPress.com or Pressable site to pull from (`url`, the only
 * pullable site, or the user's choice) and opens its exporter. Returns null
 * when the user cancels the picker.
 */
export async function resolveSourceSite(
	url?: string,
	verbose = false
): Promise< PullSource | null > {
	const token = await readAuthToken();
	if ( ! token ) {
		throw new LoggerError(
			__(
				'WordPress.com authentication is required. Run `studio auth login` to pull a WordPress.com or Pressable site.'
			)
		);
	}
	let sites: SyncSite[];
	try {
		sites = await fetchSyncableSites( token.accessToken );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to load WordPress.com sites' ), error );
	}

	let resolvedUrl: string;
	let wpComSite: SyncSite;

	if ( url ) {
		const matched = findMatchingWpComSite( sites, url );
		if ( ! matched ) {
			throw new LoggerError(
				__( 'This URL is not a WordPress.com or Pressable site connected to your account.' )
			);
		}
		if ( matched.syncSupport !== 'syncable' ) {
			throw getSyncSupportError( matched );
		}
		resolvedUrl = matched.url;
		wpComSite = matched;
	} else {
		const pullableSites = sites.filter( ( site ) => site.syncSupport === 'syncable' );
		if ( pullableSites.length === 0 ) {
			// A lone site gets the specific reason it can't be pulled.
			if ( sites.length === 1 ) {
				throw getSyncSupportError( sites[ 0 ] );
			}
			throw new LoggerError(
				__(
					'No pullable WordPress.com or Pressable sites found. Pulling requires a site with hosting features enabled.'
				)
			);
		}

		if ( pullableSites.length > 1 ) {
			if ( ! process.stdin.isTTY ) {
				throw new LoggerError(
					__( 'Multiple WordPress.com sites are available. Re-run with `--url <site-url>`.' )
				);
			}

			// The picker shows sites that can't be pulled as disabled.
			const picked = await pickSyncSite( sites, __( 'Select a site to pull from' ) );
			if ( ! picked ) {
				return null;
			}

			wpComSite = picked;
			resolvedUrl = picked.url;
		} else {
			wpComSite = pullableSites[ 0 ];
			resolvedUrl = wpComSite.url;
			console.log( `${ __( 'Using your only connected WordPress.com site:' ) } ${ resolvedUrl }` );
			console.log( '' );
		}
	}

	return {
		url: resolvedUrl,
		exporter: await enableReprintExporter( wpComSite.id, token.accessToken, verbose ),
		wpComSite,
		wpComToken: token,
	};
}

/** The URL of the Jetpack Reprint exporter on a site. */
export function getReprintApiUrlForSite( siteUrl: string ): string {
	const apiUrl = new URL( siteUrl );
	apiUrl.search = '?reprint-api-jetpack';
	return apiUrl.toString();
}
