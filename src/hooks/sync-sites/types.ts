import { z } from 'zod';

export const LatestRewindIdResponseSchema = z.object( {
	body: z.object( {
		success: z.boolean(),
		rewind_id: z.string(),
	} ),
	status: z.number(),
} );

export const BackupLsItemSchema = z.object( {
	type: z.enum( [ 'file', 'dir', 'theme', 'plugin' ] ),
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

export type LatestRewindIdResponse = z.infer< typeof LatestRewindIdResponseSchema >;
export type BackupLsItem = z.infer< typeof BackupLsItemSchema >;
export type BackupLsResponse = z.infer< typeof BackupLsResponseSchema >;
export type BackupLsRequest = z.infer< typeof BackupLsRequestSchema >;
