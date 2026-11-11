import { __ } from '@wordpress/i18n';
import { openExporter, type PullSource } from 'cli/lib/pull/pull-source';
import { runReprintCommandUntilComplete } from 'cli/lib/pull/reprint-client';
import { getReprintMetadata } from 'cli/lib/pull/reprint-metadata';
import { toLoggerError, wpcomSites } from 'cli/lib/sync-api';
import { LoggerError } from 'cli/logger';

/**
 * Installs the key Reprint signs requests with on the site, generating one
 * if needed. Installing on every pull replaces a key another machine or local
 * site installed since. Reprint finds the private key in the state directory
 * itself, so no Reprint command needs a credential argument.
 */
export async function ensureReprintKey( params: {
	source: PullSource;
	apiUrl: string;
	stateDirectory: string;
	verbose: boolean;
} ): Promise< void > {
	const { source, apiUrl, stateDirectory, verbose } = params;

	const metadata = await getReprintMetadata( { apiUrl, stateDirectory, verbose } );
	const publicKey =
		metadata.key?.publicKey ?? ( await generateReprintKey( { apiUrl, stateDirectory, verbose } ) );

	try {
		await wpcomSites.pull!.installExporterKey(
			{ token: source.wpComToken.accessToken },
			{ id: source.wpComSite.id },
			publicKey
		);
	} catch ( error ) {
		throw toLoggerError(
			error,
			__( 'Failed to install the migration key on the WordPress.com site' )
		);
	}
	// Opens the export window, which stays closed on a site that had no key.
	const reenabled = await openExporter( source, apiUrl );
	if ( ! reenabled.hasKey ) {
		throw new LoggerError(
			__( 'The WordPress.com site did not accept the migration key. Please try again.' )
		);
	}
}

/** Stores a new private key in the state directory and returns its public key. */
async function generateReprintKey( options: {
	apiUrl: string;
	stateDirectory: string;
	verbose: boolean;
} ): Promise< string > {
	const result = await runReprintCommandUntilComplete(
		[ 'keygen', options.apiUrl, `--state-dir=${ options.stateDirectory }` ],
		undefined,
		{ verboseCommands: options.verbose }
	);

	const publicKey = result.report?.public_key;
	if ( typeof publicKey !== 'string' || ! publicKey ) {
		throw new Error(
			`reprint keygen did not report a public key. Output: ${ result.stdout } ${ result.stderr }`
		);
	}
	return publicKey;
}
