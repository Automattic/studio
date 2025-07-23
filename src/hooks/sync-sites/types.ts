import { z } from 'zod';

export const LatestRewindIdResponseSchema = z.object( {
	body: z.object( {
		success: z.boolean(),
		rewind_id: z.string(),
	} ),
	status: z.number(),
} );

export const BackupLsItemSchema = z.object( {
	type: z.string(),
	has_children: z.boolean().optional(),
	period: z.string().optional(),
	id: z.string(),
	total_items: z.number().optional(),
	manifest_path: z.string().optional(),
} );

export const BackupLsResponseSchema = z.object( {
	body: z.object( {
		ok: z.boolean(),
		error: z.string(),
		contents: z.record( z.string(), BackupLsItemSchema ),
	} ),
	status: z.number(),
	headers: z.object( {
		Allow: z.string(),
	} ),
} );

export const BackupLsRequestSchema = z.object( {
	backup_id: z.string(),
	path: z.string(),
} );

// Known file types from the API
export const KNOWN_FILE_TYPES = {
	FILE: 'file',
	DIR: 'dir',
	THEME: 'theme',
	PLUGIN: 'plugin',
	UNKNOWN: 'unknown',
} as const;

export type KnownFileType = ( typeof KNOWN_FILE_TYPES )[ keyof typeof KNOWN_FILE_TYPES ];

// Utility function to safely map remote types to known types
export const mapRemoteTypeToKnown = ( remoteType: string ): KnownFileType => {
	const knownTypes = Object.values( KNOWN_FILE_TYPES ) as string[];
	return knownTypes.includes( remoteType )
		? ( remoteType as KnownFileType )
		: KNOWN_FILE_TYPES.UNKNOWN;
};

export type LatestRewindIdResponse = z.infer< typeof LatestRewindIdResponseSchema >;
export type BackupLsItem = z.infer< typeof BackupLsItemSchema >;
export type BackupLsResponse = z.infer< typeof BackupLsResponseSchema >;
export type BackupLsRequest = z.infer< typeof BackupLsRequestSchema >;
