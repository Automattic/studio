import { arePathsEqual, isWordPressDirectory } from '@studio/common/lib/fs-utils';
import { __ } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	type SiteData,
	type SiteStatus,
	unlockCliConfig,
} from './core';

/**
 * The site's health status, defaulting a missing value to `ready`.
 *
 * Records created before the `status` field existed (and every normal
 * `site create`) have no explicit value; only a reprint pull writes
 * `pulling`/`pull-failed`. Every reader that cares whether a site is a
 * healthy, fully-written install should go through this rather than
 * reading `site.status` directly, so the legacy/absent case is handled
 * uniformly.
 */
export function getSiteStatus( site: SiteData ): SiteStatus {
	return site.status ?? 'ready';
}

export async function getSiteByFolder( siteFolder: string ): Promise< SiteData > {
	const config = await readCliConfig();
	const site = config.sites.find( ( site ) => arePathsEqual( site.path, siteFolder ) );

	if ( ! site ) {
		if ( isWordPressDirectory( siteFolder ) ) {
			throw new LoggerError(
				__( 'The specified directory is not added to Studio. Use `studio create` to add it.' )
			);
		}

		throw new LoggerError( __( 'The specified directory is not added to Studio.' ) );
	}

	return site;
}

export async function findSiteByFolder( siteFolder: string ): Promise< SiteData | undefined > {
	const config = await readCliConfig();
	return config.sites.find( ( site ) => arePathsEqual( site.path, siteFolder ) );
}

export function getSiteUrl( site: SiteData ): string {
	if ( site.url ) {
		return site.url;
	}

	if ( site.customDomain ) {
		const protocol = site.enableHttps ? 'https' : 'http';
		return `${ protocol }://${ site.customDomain }`;
	}

	return `http://localhost:${ site.port }`;
}

export async function updateSiteLatestCliPid( siteId: string, pid: number ): Promise< void > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const site = config.sites.find( ( s ) => s.id === siteId );

		if ( ! site ) {
			throw new LoggerError( __( 'Site not found' ) );
		}

		site.latestCliPid = pid;
		await saveCliConfig( config );
	} finally {
		await unlockCliConfig();
	}
}

export async function clearSiteLatestCliPid( siteId: string ): Promise< void > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const site = config.sites.find( ( s ) => s.id === siteId );

		if ( ! site ) {
			throw new LoggerError( __( 'Site not found' ) );
		}

		delete site.latestCliPid;
		await saveCliConfig( config );
	} finally {
		await unlockCliConfig();
	}
}

export async function updateSitePhpVersion( siteId: string, phpVersion: string ): Promise< void > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const site = config.sites.find( ( s ) => s.id === siteId );

		if ( ! site ) {
			throw new LoggerError( __( 'Site not found' ) );
		}

		site.phpVersion = phpVersion;
		await saveCliConfig( config );
	} finally {
		await unlockCliConfig();
	}
}

export async function removeSiteFromConfig( siteId: string ): Promise< void > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		config.sites = config.sites.filter( ( s ) => s.id !== siteId );
		await saveCliConfig( config );
	} finally {
		await unlockCliConfig();
	}
}
