import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type TracksSiteCreateFlowType } from '@studio/common/lib/record-tracks-event';
import { type SiteFileAccess } from '@studio/common/lib/site-file-access';
import { siteModeFromRuntime, type SiteRuntime } from '@studio/common/lib/site-runtime';
import { isWordPressDevVersion } from '@studio/common/lib/wordpress-version-utils';
import type { Blueprint } from '@wp-playground/blueprints';

export interface SiteCreateOptions {
	path: string;
	name?: string;
	wpVersion?: string;
	phpVersion?: string;
	runtime?: SiteRuntime;
	fileAccess?: SiteFileAccess;
	customDomain?: string;
	enableHttps?: boolean;
	siteId?: string;
	// Parsed Blueprint JSON to apply on creation. Written to a temp file and
	// passed as --blueprint; `originalBlueprintPath` (an extracted bundle's
	// blueprint.json path or a URL) lets the CLI resolve relative assets.
	blueprint?: Blueprint;
	originalBlueprintPath?: string;
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
	noStart?: boolean;
	// Telemetry hint for the `studio_site_created` Tracks event. Not a functional site option — the
	// CLI infers `blueprint` on its own, so only import/sync/duplicate are threaded through here.
	flowType?: TracksSiteCreateFlowType;
}

/**
 * Build the `site create` CLI args shared by the desktop app and the local web
 * server (so both create sites — including from a Blueprint — identically). When
 * a blueprint is supplied it's written to a temp file and passed as
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
	if ( options.runtime ) {
		args.push( '--runtime', siteModeFromRuntime( options.runtime ) );
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

	let blueprintTempPath: string | undefined;
	if ( options.blueprint ) {
		blueprintTempPath = path.join( os.tmpdir(), `studio-blueprint-${ crypto.randomUUID() }.json` );
		fs.writeFileSync( blueprintTempPath, JSON.stringify( options.blueprint ) );
		args.push( '--blueprint', blueprintTempPath );
		if ( options.originalBlueprintPath ) {
			args.push( '--original-blueprint-path', options.originalBlueprintPath );
		}
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
