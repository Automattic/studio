import { z } from 'zod';
import { runReprintCommandUntilComplete } from 'cli/lib/pull/migration-client';
import type { SiteRuntime } from '@studio/common/lib/site-runtime';

const sourceSiteSchema = z.object( {
	homeUrl: z.string().nullable(),
	siteUrl: z.string().nullable(),
	tablePrefix: z.string().nullable(),
	wordpressDatabaseCharset: z.string().nullable(),
	serverDatabaseCharset: z.string().nullable(),
	contentDirectory: z.string().nullable(),
	wordpressAbsolutePath: z.string().nullable(),
	wordpressRoots: z.array( z.string() ),
	extraDirectories: z.array( z.string() ),
} );

const reprintMetadataSchema = z.object( {
	hasCompletedOnce: z.boolean(),
	hasLocalIndex: z.boolean(),
	hasSkippedFiles: z.boolean(),
	pullStage: z.unknown(),
	sourceSite: sourceSiteSchema,
} );

export type ReprintMetadata = z.infer< typeof reprintMetadataSchema >;

export const emptyReprintMetadata: ReprintMetadata = {
	hasCompletedOnce: false,
	hasLocalIndex: false,
	hasSkippedFiles: false,
	pullStage: null,
	sourceSite: {
		homeUrl: null,
		siteUrl: null,
		tablePrefix: null,
		wordpressDatabaseCharset: null,
		serverDatabaseCharset: null,
		contentDirectory: null,
		wordpressAbsolutePath: null,
		wordpressRoots: [],
		extraDirectories: [],
	},
};

export async function getReprintMetadata( options: {
	apiUrl: string;
	stateDirectory: string;
	rawDirectory: string;
	runtime: SiteRuntime;
	verbose: boolean;
} ): Promise< ReprintMetadata > {
	const result = await runReprintCommandUntilComplete(
		options.stateDirectory,
		options.rawDirectory,
		[ 'import-metadata', options.apiUrl, `--state-dir=${ options.stateDirectory }` ],
		undefined,
		{ runtime: options.runtime, verboseCommands: options.verbose }
	);

	try {
		return reprintMetadataSchema.parse( JSON.parse( result.stdout.trim() ) );
	} catch ( error ) {
		throw new Error( `Invalid metadata returned by reprint: ${ String( error ) }` );
	}
}

export function decodeReprintPath( value: string ): string {
	const prefix = 'base64:';
	return value.startsWith( prefix )
		? Buffer.from( value.slice( prefix.length ), 'base64' ).toString( 'utf-8' )
		: value;
}

export function getCoreRoots( metadata: ReprintMetadata ): string[] {
	const roots = metadata.sourceSite.wordpressRoots.map( decodeReprintPath );
	return roots.filter(
		( rootPath ) =>
			! roots.some( ( other ) => other !== rootPath && other.startsWith( `${ rootPath }/` ) )
	);
}
