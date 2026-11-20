import path from 'path';
import { readConfig, updateConfig } from '@studio/common/lib/config/store';
import { arePathsEqual, isWordPressDirectory } from '@studio/common/lib/fs-utils';
import { HEADLESS_WORDPRESS_SUBDIR } from '@studio/common/lib/site-frontend';
import { __ } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';
import type { ConfigSite } from '@studio/common/lib/config/schema';
import type { SiteFrontend } from '@studio/common/lib/site-frontend';

// A site with a frontend project Studio supervises next to WordPress.
export type HeadlessSite = ConfigSite & { frontend: SiteFrontend };

export async function getSiteByFolder( siteFolder: string ): Promise< ConfigSite > {
	const config = await readConfig();
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

// Like WP-CLI, finds the site from any directory inside it, not only its root.
// A headless site is also found from its frontend project and from the
// container folder holding both halves.
export async function getSiteContainingFolder( folder: string ): Promise< ConfigSite > {
	const config = await readConfig();
	for ( let directory = path.resolve( folder ); ; directory = path.dirname( directory ) ) {
		const site = config.sites.find(
			( candidate ) =>
				arePathsEqual( candidate.path, directory ) ||
				( candidate.frontend &&
					( arePathsEqual( candidate.frontend.path, directory ) ||
						arePathsEqual( getHeadlessContainerPath( candidate ), directory ) ) )
		);
		if ( site ) {
			return site;
		}
		if ( path.dirname( directory ) === directory ) {
			return getSiteByFolder( folder );
		}
	}
}

export async function findSiteByFolder( siteFolder: string ): Promise< ConfigSite | undefined > {
	const config = await readConfig();
	return config.sites.find( ( site ) => arePathsEqual( site.path, siteFolder ) );
}

export async function findSiteById( siteId: string ): Promise< ConfigSite | undefined > {
	const config = await readConfig();
	return config.sites.find( ( site ) => site.id === siteId );
}

// The folder holding both halves of a headless site created with the default
// layout (`<container>/wordpress` + `<container>/frontend`); the WordPress
// directory itself otherwise.
export function getHeadlessContainerPath( site: ConfigSite ): string {
	if ( site.frontend && path.basename( site.path ) === HEADLESS_WORDPRESS_SUBDIR ) {
		return path.dirname( site.path );
	}
	return site.path;
}

export function getSiteUrl( site: ConfigSite ): string {
	if ( site.url ) {
		return site.url;
	}

	if ( site.customDomain ) {
		const protocol = site.enableHttps ? 'https' : 'http';
		return `${ protocol }://${ site.customDomain }`;
	}

	// Set by `studio serve` when the sites are reached at public addresses, such as on a cloud
	// machine, where `{id}` names the site.
	const template = process.env.STUDIO_SITE_URL_TEMPLATE;
	if ( template ) {
		return template.replace( '{id}', site.id );
	}

	return `http://localhost:${ site.port }`;
}

export async function updateSiteLatestCliPid( siteId: string, pid: number ): Promise< void > {
	return updateConfig( ( config ) => {
		const site = config.sites.find( ( s ) => s.id === siteId );

		if ( ! site ) {
			throw new LoggerError( __( 'Site not found' ) );
		}

		site.latestCliPid = pid;
	} );
}

export async function clearSiteLatestCliPid( siteId: string ): Promise< void > {
	return updateConfig( ( config ) => {
		const site = config.sites.find( ( s ) => s.id === siteId );

		if ( ! site ) {
			throw new LoggerError( __( 'Site not found' ) );
		}

		delete site.latestCliPid;
	} );
}

export async function updateSitePhpVersion( siteId: string, phpVersion: string ): Promise< void > {
	return updateConfig( ( config ) => {
		const site = config.sites.find( ( s ) => s.id === siteId );

		if ( ! site ) {
			throw new LoggerError( __( 'Site not found' ) );
		}

		site.phpVersion = phpVersion;
	} );
}

export async function removeSiteFromConfig( siteId: string ): Promise< void > {
	return updateConfig( ( config ) => {
		config.sites = config.sites.filter( ( s ) => s.id !== siteId );
	} );
}
