import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { decodePassword } from '@studio/common/lib/passwords';
import { getSiteFileAccess } from '@studio/common/lib/site-file-access';
import { getSiteRuntime, siteModeFromRuntime } from '@studio/common/lib/site-runtime';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import CliTable3 from 'cli-table3';
import { type SiteData } from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

type ConfigValue = string | boolean | undefined;

interface ConfigEntry {
	key: string;
	value: ConfigValue;
}

// The settable knobs exposed by `studio config set`, keyed and ordered to match
// that command's flags so the output round-trips: every key here can be read
// back with `config get <key>` and written with `config set --<key>`. This is
// intentionally narrower than the runtime-oriented `status` output (no URLs, no
// online state). `runtime` is reported as the user-facing mode (`native`/
// `sandbox`) rather than the internal runtime (`native-php`/`playground`).
function getConfigEntries( site: SiteData ): ConfigEntry[] {
	return [
		{ key: 'name', value: site.name },
		{ key: 'domain', value: site.customDomain },
		{ key: 'https', value: site.enableHttps ?? false },
		{ key: 'php', value: site.phpVersion },
		{ key: 'wp', value: getWordPressVersion( site.path ) },
		{ key: 'runtime', value: siteModeFromRuntime( getSiteRuntime( site ) ) },
		{ key: 'file-access', value: getSiteFileAccess( site ) },
		{ key: 'xdebug', value: site.enableXdebug ?? false },
		{ key: 'admin-username', value: site.adminUsername ?? 'admin' },
		{
			key: 'admin-password',
			value: site.adminPassword ? decodePassword( site.adminPassword ) : undefined,
		},
		{ key: 'admin-email', value: site.adminEmail },
		{ key: 'debug-log', value: site.enableDebugLog ?? false },
		{ key: 'debug-display', value: site.enableDebugDisplay ?? false },
	];
}

function formatValue( value: ConfigValue ): string {
	if ( value === undefined ) {
		return '';
	}
	return String( value );
}

export async function runCommand(
	siteFolder: string,
	key: string | undefined,
	format: 'table' | 'json'
): Promise< void > {
	const site = await getSiteByFolder( siteFolder );
	const entries = getConfigEntries( site );

	// Single-key lookup: print the raw value with no formatting so it can be
	// consumed directly in scripts (e.g. `studio config get php`).
	if ( key !== undefined ) {
		const entry = entries.find( ( candidate ) => candidate.key === key );
		if ( ! entry ) {
			throw new LoggerError(
				sprintf(
					/* translators: 1: requested config key, 2: comma-separated list of valid keys */
					__( 'Unknown config key "%1$s". Valid keys: %2$s' ),
					key,
					entries.map( ( candidate ) => candidate.key ).join( ', ' )
				)
			);
		}
		console.log( formatValue( entry.value ) );
		return;
	}

	if ( format === 'json' ) {
		const data = Object.fromEntries(
			entries.map( ( { key: entryKey, value } ) => [ entryKey, value ?? null ] )
		);
		console.log( JSON.stringify( data, null, 2 ) );
		return;
	}

	const table = new CliTable3( {
		wordWrap: true,
		wrapOnWordBoundary: false,
		style: {
			head: [],
			border: [],
		},
	} );

	for ( const { key: entryKey, value } of entries ) {
		table.push( [ entryKey, formatValue( value ) ] );
	}

	console.table( table.toString() );
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'get [key]',
		describe: __( 'Get site configuration' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'key', {
					type: 'string',
					describe: __( 'Specific setting to read (omit to list all settings)' ),
				} )
				.option( 'format', {
					type: 'string',
					choices: [ 'table', 'json' ] as const,
					default: 'table' as const,
					description: __( 'Output format (ignored when a key is provided)' ),
				} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, argv.key, argv.format );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to read site configuration' ), error );
					logger.reportError( loggerError );
				}
				process.exit( 1 );
			}
		},
	} );
};
