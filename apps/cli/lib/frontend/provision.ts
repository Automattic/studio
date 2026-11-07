/**
 * The WordPress side of a headless site: pretty permalinks, a least-privilege
 * user the frontend authenticates as, WPGraphQL when the template uses it, and
 * the frontend's `.env.local` carrying the env contract.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveSupportedPhpVersion } from '@studio/common/lib/php-binary-metadata';
import {
	buildFrontendEnv,
	formatEnvFile,
	HEADLESS_APPLICATION_NAME,
	HEADLESS_FRONTEND_USER,
	type SiteFrontend,
} from '@studio/common/lib/site-frontend';
import { SiteCommandLoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { LoggerError, type Logger } from 'cli/logger';
import type { HeadlessSite, SiteData } from 'cli/lib/cli-config/core';

const FRONTEND_ENV_FILENAME = '.env.local';

interface WpCliResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

async function wp( site: SiteData, args: string[] ): Promise< WpCliResult > {
	await using command = await runWpCliCommand( site, args, {
		phpVersion: resolveSupportedPhpVersion( site.phpVersion ),
	} );
	const [ exitCode, stdout, stderr ] = await Promise.all( [
		command.response.exitCode,
		command.response.stdoutText,
		command.response.stderrText,
	] );
	return { exitCode, stdout, stderr };
}

async function wpOrThrow( site: SiteData, args: string[], message: string ): Promise< string > {
	const result = await wp( site, args );
	if ( result.exitCode !== 0 ) {
		throw new LoggerError( message, new Error( result.stderr.trim() || result.stdout.trim() ) );
	}
	return result.stdout.trim();
}

/** The frontend's `.env.local`, which carries the env contract. */
export function getFrontendEnvPath( frontend: Pick< SiteFrontend, 'path' > ): string {
	return path.join( frontend.path, FRONTEND_ENV_FILENAME );
}

export function writeFrontendEnvFile(
	frontend: SiteFrontend,
	env: Record< string, string >
): string {
	fs.mkdirSync( frontend.path, { recursive: true } );
	const envPath = getFrontendEnvPath( frontend );
	fs.writeFileSync( envPath, formatEnvFile( env ), { mode: 0o600 } );
	return envPath;
}

async function ensureFrontendUser( site: SiteData ): Promise< void > {
	const existing = await wp( site, [ 'user', 'get', HEADLESS_FRONTEND_USER, '--field=ID' ] );
	if ( existing.exitCode === 0 && existing.stdout.trim() ) {
		return;
	}
	await wpOrThrow(
		site,
		[
			'user',
			'create',
			HEADLESS_FRONTEND_USER,
			`${ HEADLESS_FRONTEND_USER }@example.com`,
			'--role=editor',
			`--user_pass=${ crypto.randomBytes( 24 ).toString( 'base64url' ) }`,
			'--porcelain',
		],
		__( 'Failed to create the frontend user' )
	);
}

/**
 * Runs once the site's WordPress is running. Safe to repeat: the frontend user
 * is reused, and each run issues a new application password.
 */
export async function provisionHeadlessBackend(
	site: HeadlessSite,
	logger: Logger< string >
): Promise< void > {
	logger.reportStart(
		SiteCommandLoggerAction.SETUP_FRONTEND,
		__( 'Configuring WordPress for the frontend…' )
	);

	await wpOrThrow(
		site,
		[ 'rewrite', 'structure', '/%postname%/' ],
		__( 'Failed to set the permalink structure' )
	);

	await ensureFrontendUser( site );

	const applicationPassword = await wpOrThrow(
		site,
		[
			'user',
			'application-password',
			'create',
			HEADLESS_FRONTEND_USER,
			HEADLESS_APPLICATION_NAME,
			'--porcelain',
		],
		__( 'Failed to create the frontend application password' )
	);

	if ( site.frontend.api === 'graphql' ) {
		const graphql = await wp( site, [ 'plugin', 'install', 'wp-graphql', '--activate' ] );
		if ( graphql.exitCode !== 0 ) {
			logger.reportWarning(
				__(
					'Could not install WPGraphQL, which needs an internet connection. The frontend can use the REST API until you install it.'
				)
			);
		}
	}

	const envPath = writeFrontendEnvFile(
		site.frontend,
		buildFrontendEnv( {
			siteUrl: getSiteUrl( site ),
			frontend: site.frontend,
			applicationUser: HEADLESS_FRONTEND_USER,
			applicationPassword,
		} )
	);

	// translators: %s is the path of the frontend's env file
	logger.reportSuccess( sprintf( __( 'WordPress configured for the frontend (%s)' ), envPath ) );
}
