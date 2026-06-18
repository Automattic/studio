import path from 'path';
import { arePathsEqual, isWordPressDirectory } from '@studio/common/lib/fs-utils';
import { __, sprintf } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	type SiteData,
	unlockCliConfig,
} from './core';

export async function getSiteByFolder( siteFolder: string ): Promise< SiteData > {
	const config = await readCliConfig();
	const site = config.sites.find( ( site ) => arePathsEqual( site.path, siteFolder ) );

	if ( ! site ) {
		if ( isWordPressDirectory( siteFolder ) ) {
			throw new LoggerError(
				__( 'The specified directory is not added to Studio. Use `studio site create` to add it.' )
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

export function isHeadless( site: SiteData ): boolean {
	return site.headless === true;
}

/**
 * Throws if the site is headless. Gates commands (sync, backup, previews) whose behavior isn't
 * defined for headless sites yet: they assume a site is a single standalone WordPress install and
 * would otherwise produce broken (pull, previews) or silently incomplete — frontend-omitting —
 * results (export, import, push).
 */
export function assertHeadlessUnsupported( site: SiteData, action: string ): void {
	if ( isHeadless( site ) ) {
		throw new LoggerError(
			sprintf(
				/* translators: %s is the command/action name, e.g. "Export" */
				__( '%s is not yet supported for headless sites.' ),
				action
			)
		);
	}
}

// For headless sites, `site.path` is a container holding the WordPress install and the static
// frontend side by side. WordPress lives in this subfolder.
export const WORDPRESS_SUBDIR = 'wordpress';

/**
 * The WordPress install directory. For classic sites this is `site.path` itself; for headless sites
 * WordPress lives in a `wordpress/` subfolder of the container (alongside `frontend/`). Use this
 * anywhere that reads or writes WordPress files on disk (wp-content, wp-config.php, wp-cli, …).
 */
export function getWpPath( site: SiteData ): string {
	return isHeadless( site ) ? path.join( site.path, WORDPRESS_SUBDIR ) : site.path;
}

// The frontend project directory (a sibling of the WordPress install) — what an editor / Studio
// Code opens. Tooling and source live here; only the served subfolder is web-exposed.
export const FRONTEND_SUBDIR = 'frontend';

/**
 * The frontend project directory for a headless site (`<site>/frontend`). This is the project root
 * an editor opens; the actual served web root is a subfolder of it (see {@link getFrontendPath}).
 */
export function getFrontendProjectPath( site: SiteData ): string {
	return path.join( site.path, FRONTEND_SUBDIR );
}

/**
 * The served web root for a headless site — the subfolder of the frontend project that the frontend
 * server exposes (e.g. `frontend/public` for the static template). Falls back to the static
 * template's `frontend/public` when not explicitly stored.
 */
export function getFrontendPath( site: SiteData ): string {
	return site.frontendPath ?? path.join( site.path, FRONTEND_SUBDIR, 'public' );
}

/**
 * The port WordPress binds to. For headless sites the top-level `port` belongs to the static
 * frontend, so WordPress lives on `wpPort`; classic sites serve WordPress directly on `port`.
 */
export function getWpServerPort( site: SiteData ): number {
	if ( isHeadless( site ) && site.wpPort !== undefined ) {
		return site.wpPort;
	}
	return site.port;
}

/**
 * The base URL of the WordPress site itself. For classic sites this is the same as the public site
 * URL; for headless sites it targets the WordPress backend (the custom-domain proxy when set,
 * otherwise the backend `wpPort`) rather than the static frontend `port`. Use this for anything
 * that talks to WordPress directly — admin, auto-login, REST.
 */
export function getWpUrl( site: SiteData ): string {
	if ( site.customDomain ) {
		const protocol = site.enableHttps ? 'https' : 'http';
		return `${ protocol }://${ site.customDomain }`;
	}

	return `http://localhost:${ getWpServerPort( site ) }`;
}

/**
 * The WordPress admin URL. For headless sites this targets the WordPress backend, not the frontend.
 */
export function getWpAdminUrl( site: SiteData ): string {
	return `${ getWpUrl( site ) }/wp-admin`;
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

export async function updateSiteAutoStart( siteId: string, autoStart: boolean ): Promise< void > {
	try {
		await lockCliConfig();
		const config = await readCliConfig();
		const site = config.sites.find( ( s ) => s.id === siteId );

		if ( ! site ) {
			throw new LoggerError( __( 'Site not found' ) );
		}

		site.autoStart = autoStart;
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
