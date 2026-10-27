import { __ } from '@wordpress/i18n';
import {
	enableReprintExporter,
	installReprintPublicKey,
	type ReprintExporterStatus,
} from 'cli/lib/api';
import { runReprintCommandUntilComplete } from 'cli/lib/pull/migration-client';
import { getReprintMetadata } from 'cli/lib/pull/reprint-metadata';
import { LoggerError } from 'cli/logger';

/**
 * Makes sure Reprint can sign its requests to the remote exporter with a key
 * the site accepts.
 *
 * Reprint stores the private key in the state directory and finds it on its
 * own, so remote commands need no credential argument. A key is generated
 * when `pull-metadata` reports none, and installed on the site when it was
 * just generated or the site has no key at all. Installing a key on a site
 * that had none also requires opening its export window again.
 */
export async function ensureReprintKey( params: {
	wpComSiteId: number;
	wpComAccessToken: string;
	exporter: ReprintExporterStatus;
	apiUrl: string;
	stateDirectory: string;
	verbose: boolean;
} ): Promise< void > {
	const { wpComSiteId, wpComAccessToken, exporter, apiUrl, stateDirectory, verbose } = params;

	const metadata = await getReprintMetadata( { apiUrl, stateDirectory, verbose } );
	let publicKey: string | undefined;
	if ( ! metadata.key ) {
		publicKey = await generateReprintKey( { apiUrl, stateDirectory, verbose } );
	} else if ( ! exporter.hasPublicKey ) {
		publicKey = metadata.key.publicKey;
	}

	if ( ! publicKey ) {
		return;
	}

	await installReprintPublicKey( wpComSiteId, wpComAccessToken, publicKey );
	if ( ! exporter.hasPublicKey ) {
		const reenabled = await enableReprintExporter( wpComSiteId, wpComAccessToken, verbose );
		if ( ! reenabled.hasPublicKey ) {
			throw new LoggerError(
				__( 'The WordPress.com site did not accept the migration key. Please try again.' )
			);
		}
	}
}

/**
 * Runs `reprint keygen`, which stores a new private key for this remote in the
 * state directory, and returns the one-line public key to install on the site.
 */
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
