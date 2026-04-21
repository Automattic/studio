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

// The wpcom endpoint returns a bare boolean. Accept either shape so we're tolerant
// of a future server-side change that returns richer info (e.g. { has_enough_quota, message }).
export const validateQuotaResponseSchema = z.union( [
	z.boolean(),
	z.object( {
		has_enough_quota: z.boolean(),
		message: z.string().optional(),
	} ),
] );

export type StagingSite = z.infer< typeof stagingSiteSchema >;
export type SyncState = z.infer< typeof syncStateResponseSchema >;

// Normalised shape that callers receive after `validateStagingQuota()` folds
// a bare boolean wire response into an object.
export type ValidateQuotaResponse = {
	has_enough_quota: boolean;
	message?: string;
};
