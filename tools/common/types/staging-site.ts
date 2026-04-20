import { z } from 'zod';

export const stagingSiteSchema = z.object( {
	id: z.number(),
	name: z.string(),
	url: z.string(),
} );

export const listStagingSitesResponseSchema = z.array( stagingSiteSchema );

export const createStagingSiteResponseSchema = stagingSiteSchema;

export const syncStateResponseSchema = z.object( {
	status: z.enum( [ 'in-progress', 'finished', 'failed', 'idle' ] ),
	started_at: z.string().optional(),
	finished_at: z.string().optional(),
	direction: z.enum( [ 'push', 'pull' ] ).optional(),
} );

export const validateQuotaResponseSchema = z.object( {
	has_enough_quota: z.boolean(),
	message: z.string().optional(),
} );

export type StagingSite = z.infer< typeof stagingSiteSchema >;
export type SyncState = z.infer< typeof syncStateResponseSchema >;
export type ValidateQuotaResponse = z.infer< typeof validateQuotaResponseSchema >;
