import {
	DEFAULT_ADMIN_EMAIL,
	DEFAULT_ADMIN_USERNAME,
	decodeAdminPassword,
} from '@studio/common/lib/passwords';
import { getSiteFileAccess, type SiteFileAccess } from '@studio/common/lib/site-file-access';
import { isWordPressDevVersion } from '@studio/common/lib/wordpress-version-utils';
import {
	getWpEnvironmentType,
	type WpEnvironmentType,
} from '@studio/common/lib/wp-environment-type';

/** Options accepted by the CLI `site set` command. */
export interface EditSiteOptions {
	path: string;
	siteId: string;
	name?: string;
	domain?: string;
	https?: boolean;
	php?: string;
	wp?: string;
	fileAccess?: SiteFileAccess;
	xdebug?: boolean;
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
	debugLog?: boolean;
	debugDisplay?: boolean;
	scriptDebug?: boolean;
	environmentType?: WpEnvironmentType;
}

interface EditableSite {
	id: string;
	path: string;
	name?: string;
	customDomain?: string;
	enableHttps?: boolean;
	phpVersion?: string;
	fileAccess?: SiteFileAccess;
	enableXdebug?: boolean;
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
	enableDebugLog?: boolean;
	enableDebugDisplay?: boolean;
	enableScriptDebug?: boolean;
	environmentType?: WpEnvironmentType;
}

/**
 * Diff a site settings form against the stored site. Unset fields compare as
 * the value the CLI applies for them, so saving an untouched form changes nothing.
 */
export function getSiteEditOptions(
	current: EditableSite,
	updated: Partial< EditableSite >,
	wpVersion?: string
): EditSiteOptions {
	const options: EditSiteOptions = { path: current.path, siteId: current.id };
	if ( updated.name !== undefined && updated.name !== current.name ) {
		options.name = updated.name;
	}
	if ( ( updated.customDomain ?? '' ) !== ( current.customDomain ?? '' ) ) {
		options.domain = updated.customDomain ?? '';
	}
	if ( ( updated.enableHttps ?? false ) !== ( current.enableHttps ?? false ) ) {
		options.https = updated.enableHttps ?? false;
	}
	if ( updated.phpVersion !== undefined && updated.phpVersion !== current.phpVersion ) {
		options.php = updated.phpVersion;
	}
	if ( wpVersion ) {
		options.wp = isWordPressDevVersion( wpVersion ) ? 'nightly' : wpVersion;
	}
	if ( getSiteFileAccess( updated ) !== getSiteFileAccess( current ) ) {
		options.fileAccess = getSiteFileAccess( updated );
	}
	if ( ( updated.enableXdebug ?? false ) !== ( current.enableXdebug ?? false ) ) {
		options.xdebug = updated.enableXdebug ?? false;
	}
	if (
		( updated.adminUsername ?? DEFAULT_ADMIN_USERNAME ) !==
		( current.adminUsername ?? DEFAULT_ADMIN_USERNAME )
	) {
		options.adminUsername = updated.adminUsername;
	}
	if (
		decodeAdminPassword( updated.adminPassword ) !== decodeAdminPassword( current.adminPassword )
	) {
		// The CLI expects a plaintext password (it encodes before saving).
		options.adminPassword = decodeAdminPassword( updated.adminPassword );
	}
	// A site that never stored an email keeps whatever its WordPress admin has;
	// the form shows the default for it, which must not overwrite that email.
	if (
		( updated.adminEmail || DEFAULT_ADMIN_EMAIL ) !== ( current.adminEmail || DEFAULT_ADMIN_EMAIL )
	) {
		options.adminEmail = updated.adminEmail;
	}
	if ( ( updated.enableDebugLog ?? false ) !== ( current.enableDebugLog ?? false ) ) {
		options.debugLog = updated.enableDebugLog ?? false;
	}
	if ( ( updated.enableDebugDisplay ?? false ) !== ( current.enableDebugDisplay ?? false ) ) {
		options.debugDisplay = updated.enableDebugDisplay ?? false;
	}
	if ( ( updated.enableScriptDebug ?? false ) !== ( current.enableScriptDebug ?? false ) ) {
		options.scriptDebug = updated.enableScriptDebug ?? false;
	}
	if ( getWpEnvironmentType( updated ) !== getWpEnvironmentType( current ) ) {
		options.environmentType = getWpEnvironmentType( updated );
	}
	return options;
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
	if ( options.scriptDebug !== undefined ) {
		args.push( options.scriptDebug ? '--script-debug' : '--no-script-debug' );
	}
	if ( options.environmentType !== undefined ) {
		args.push( '--environment-type', options.environmentType );
	}

	return args;
}
