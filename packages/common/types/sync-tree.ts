import { z } from 'zod';

export type RawDirectoryEntry = {
	name: string;
	isDirectory: boolean;
	path: string;
	children?: RawDirectoryEntry[];
};

export const latestRewindIdResponseSchema = z.object( {
	body: z.object( {
		success: z.boolean(),
		rewind_id: z.string(),
	} ),
	status: z.number(),
} );

export const backupLsItemSchema = z.object( {
	type: z.string(),
	has_children: z.boolean().optional(),
	period: z.string().optional(),
	id: z.string(),
	manifest_path: z.string().optional(),
} );

export const backupLsResponseBodySchema = z.object( {
	ok: z.boolean(),
	error: z.string(),
	contents: z.record( z.string(), z.unknown() ),
} );

export const backupLsResponseSchema = z.object( {
	body: backupLsResponseBodySchema,
	status: z.number(),
	headers: z.object( {
		Allow: z.string(),
	} ),
} );

export type BackupLsItem = z.infer< typeof backupLsItemSchema >;
export type BackupLsRequest = {
	backup_id: string;
	path: string;
};
