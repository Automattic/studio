import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type TracksSiteCreateFlowType } from '@studio/common/lib/record-tracks-event';
import { type SiteFileAccess } from '@studio/common/lib/site-file-access';
import { type FrontendCreateChoice } from '@studio/common/lib/site-frontend';
import { isWordPressDevVersion } from '@studio/common/lib/wordpress-version-utils';
import type { Blueprint } from '@studio/blueprints';

export interface SiteCreateOptions {
	path: string;
	name?: string;
	wpVersion?: string;
	phpVersion?: string;
	fileAccess?: SiteFileAccess;
	customDomain?: string;
	enableHttps?: boolean;
	siteId?: string;
	// What `--blueprint` accepts (a URL, file, folder, zip or Library slug), or a Blueprint
	// itself, which is written to a temp file.
	blueprint?: string | Blueprint;
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
	noStart?: boolean;
	// Telemetry hint for the `studio_site_created` Tracks event. Not a functional site option — the
	// CLI infers `blueprint` on its own, so only import/sync/duplicate are threaded through here.
	flowType?: TracksSiteCreateFlowType;
	// Creates a headless site: passed as `--frontend <framework> [--frontend-api <api>]`.
	frontend?: FrontendCreateChoice;
}

/**
 * Build the `site create` CLI args shared by the desktop app and the local web
 * server (so both create sites — including from a Blueprint — identically). When
 * a Blueprint object is supplied it's written to a temp file and passed as
 * `--blueprint`; call the returned `cleanup` once the CLI command settles to
 * remove that temp file.
 */
export function buildSiteCreateArgs( options: SiteCreateOptions ): {
	args: string[];
	cleanup: () => void;
} {
	const args = [ 'site', 'create', '--path', options.path, '--skip-browser', '--skip-log-details' ];

	if ( options.siteId ) {
		args.push( '--id', options.siteId );
	}
	if ( options.name ) {
		args.push( '--name', options.name );
	}
	if ( options.wpVersion ) {
		args.push( '--wp', isWordPressDevVersion( options.wpVersion ) ? 'nightly' : options.wpVersion );
	}
	if ( options.phpVersion ) {
		args.push( '--php', options.phpVersion );
	}
	if ( options.fileAccess ) {
		args.push( '--file-access', options.fileAccess );
	}
	if ( options.customDomain ) {
		args.push( '--domain', options.customDomain );
	}
	if ( options.enableHttps ) {
		args.push( '--https' );
	}
	if ( options.adminUsername ) {
		args.push( '--admin-username', options.adminUsername );
	}
	if ( options.adminPassword ) {
		args.push( '--admin-password', options.adminPassword );
	}
	if ( options.adminEmail ) {
		args.push( '--admin-email', options.adminEmail );
	}
	if ( options.noStart ) {
		args.push( '--no-start' );
	}
	if ( options.flowType ) {
		args.push( '--flow-type', options.flowType );
	}
	if ( options.frontend ) {
		args.push( '--frontend', options.frontend.framework );
		args.push( '--frontend-api', options.frontend.api ?? 'rest' );
	}

	let blueprintTempPath: string | undefined;
	if ( typeof options.blueprint === 'string' ) {
		args.push( '--blueprint', options.blueprint );
	} else if ( options.blueprint ) {
		blueprintTempPath = path.join( os.tmpdir(), `studio-blueprint-${ crypto.randomUUID() }.json` );
		fs.writeFileSync( blueprintTempPath, JSON.stringify( options.blueprint ) );
		args.push( '--blueprint', blueprintTempPath );
	}

	return {
		args,
		cleanup: () => {
			if ( blueprintTempPath && fs.existsSync( blueprintTempPath ) ) {
				try {
					fs.unlinkSync( blueprintTempPath );
				} catch ( error ) {
					console.error( 'Failed to clean up temp Blueprint file:', error );
				}
			}
		},
	};
}
