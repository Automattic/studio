import { __ } from '@wordpress/i18n';
import {
	enableReprintExporter,
	installReprintPublicKey,
	type ReprintExporterStatus,
} from 'cli/lib/api';
import { ReprintError, runReprintCommandUntilComplete } from 'cli/lib/pull/reprint-client';
import { getReprintMetadata } from 'cli/lib/pull/reprint-metadata';
import { LoggerError } from 'cli/logger';

/**
 * Makes sure the site accepts the key Reprint signs requests with,
 * generating one if needed. Reprint finds the private key in the state
 * directory itself, so no Reprint command needs a credential argument.
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

	await installPublicKey( wpComSiteId, wpComAccessToken, publicKey, verbose );
}

/**
 * Reinstalls the stored key on a site that no longer accepts it, typically
 * because another machine pulling the same site installed its own key.
 */
export async function reinstallReprintKey( params: {
	wpComSiteId: number;
	wpComAccessToken: string;
	apiUrl: string;
	stateDirectory: string;
	verbose: boolean;
} ): Promise< void > {
	const { wpComSiteId, wpComAccessToken, apiUrl, stateDirectory, verbose } = params;
	const metadata = await getReprintMetadata( { apiUrl, stateDirectory, verbose } );
	if ( ! metadata.key ) {
		throw new Error( 'No Reprint key is stored for this site.' );
	}
	if ( verbose ) {
		console.error( '[reprint] The site rejected the stored key; reinstalling it.' );
	}
	await installPublicKey( wpComSiteId, wpComAccessToken, metadata.key.publicKey, verbose );
}

/**
 * Runs a Reprint command, and runs it once more after `reinstallKey` if the
 * site rejected the key.
 */
export async function withKeyRecovery< T >(
	run: () => Promise< T >,
	reinstallKey?: () => Promise< void >
): Promise< T > {
	try {
		return await run();
	} catch ( error ) {
		if (
			! reinstallKey ||
			! ( error instanceof ReprintError ) ||
			error.errorCode !== 'AUTH_UNKNOWN_KEY'
		) {
			throw error;
		}
		await reinstallKey();
		return run();
	}
}

async function installPublicKey(
	wpComSiteId: number,
	wpComAccessToken: string,
	publicKey: string,
	verbose: boolean
): Promise< void > {
	await installReprintPublicKey( wpComSiteId, wpComAccessToken, publicKey );
	// Opens the export window, which stays closed on a site that had no key.
	const reenabled = await enableReprintExporter( wpComSiteId, wpComAccessToken, verbose );
	if ( ! reenabled.hasPublicKey ) {
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
