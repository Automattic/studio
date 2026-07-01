import type { SiteFileAccess } from '@studio/common/lib/site-file-access';
import type { SiteMode } from '@studio/common/lib/site-runtime';

/** Options accepted by the CLI `site set` command. */
export interface EditSiteOptions {
	path: string;
	siteId: string;
	name?: string;
	domain?: string;
	https?: boolean;
	php?: string;
	wp?: string;
	runtime?: SiteMode;
	fileAccess?: SiteFileAccess;
	xdebug?: boolean;
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
	debugLog?: boolean;
	debugDisplay?: boolean;
}

/**
 * Build the `site set` CLI args for the given edits. Only defined fields are
 * forwarded, so callers pass just what changed.
 */
export function buildSiteSetArgs( options: EditSiteOptions ): string[] {
	const args = [ 'site', 'set', '--path', options.path ];

	if ( options.name !== undefined ) {
		args.push( '--name', options.name );
	}
	if ( options.domain !== undefined ) {
		args.push( '--domain', options.domain );
	}
	if ( options.https !== undefined ) {
		args.push( options.https ? '--https' : '--no-https' );
	}
	if ( options.php !== undefined ) {
		args.push( '--php', options.php );
	}
	if ( options.wp !== undefined ) {
		args.push( '--wp', options.wp );
	}
	if ( options.runtime !== undefined ) {
		args.push( '--runtime', options.runtime );
	}
	if ( options.fileAccess !== undefined ) {
		args.push( '--file-access', options.fileAccess );
	}
	if ( options.xdebug !== undefined ) {
		args.push( options.xdebug ? '--xdebug' : '--no-xdebug' );
	}
	if ( options.adminUsername !== undefined ) {
		args.push( '--admin-username', options.adminUsername );
	}
	if ( options.adminPassword !== undefined ) {
		args.push( '--admin-password', options.adminPassword );
	}
	if ( options.adminEmail !== undefined ) {
		args.push( '--admin-email', options.adminEmail );
	}
	if ( options.debugLog !== undefined ) {
		args.push( options.debugLog ? '--debug-log' : '--no-debug-log' );
	}
	if ( options.debugDisplay !== undefined ) {
		args.push( options.debugDisplay ? '--debug-display' : '--no-debug-display' );
	}

	return args;
}
