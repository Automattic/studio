import { z } from 'zod';
import { runReprintCommandUntilComplete } from 'cli/lib/pull/reprint-client';

const sourceSiteSchema = z.object( {
	homeUrl: z.string().nullable(),
	siteUrl: z.string().nullable(),
	wordpressDatabaseCharset: z.string().nullable(),
	serverDatabaseCharset: z.string().nullable(),
	contentDirectory: z.string().nullable(),
	// Reprint releases before WordPress/reprint#982 don't report it.
	wordpressVersion: z.string().nullable().default( null ),
	extraDirectories: z.array( z.string() ),
} );

/** The key Reprint signs requests to this remote with, or null when none is stored. */
const storedKeySchema = z
	.object( {
		id: z.string(),
		path: z.string(),
		publicKey: z.string(),
	} )
	.nullable();

const reprintMetadataSchema = z.object( {
	hasCompletedOnce: z.boolean(),
	hasLocalIndex: z.boolean(),
	hasSkippedFiles: z.boolean(),
	pullStage: z.unknown(),
	key: storedKeySchema,
	sourceSite: sourceSiteSchema,
} );

export type ReprintMetadata = z.infer< typeof reprintMetadataSchema >;

export const emptyReprintMetadata: ReprintMetadata = {
	hasCompletedOnce: false,
	hasLocalIndex: false,
	hasSkippedFiles: false,
	pullStage: null,
	key: null,
	sourceSite: {
		homeUrl: null,
		siteUrl: null,
		wordpressDatabaseCharset: null,
		serverDatabaseCharset: null,
		contentDirectory: null,
		wordpressVersion: null,
		extraDirectories: [],
	},
};

export async function getReprintMetadata( options: {
	apiUrl: string;
	stateDirectory: string;
	verbose: boolean;
} ): Promise< ReprintMetadata > {
	const result = await runReprintCommandUntilComplete(
		[ 'pull-metadata', options.apiUrl, `--state-dir=${ options.stateDirectory }` ],
		undefined,
		{ verboseCommands: options.verbose }
	);

	try {
		return reprintMetadataSchema.parse( JSON.parse( result.stdout.trim() ) );
	} catch ( error ) {
		throw new Error( `Invalid metadata returned by reprint: ${ String( error ) }` );
	}
}
