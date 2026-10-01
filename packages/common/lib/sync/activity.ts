import { z } from 'zod';
import { PUSH_PHASES } from '@studio/common/types/sync';

const syncDirectionSchema = z.enum( [ 'push', 'pull', 'preview', 'import' ] );

/**
 * What a sync is doing, as published by the CLI command running it. Every UI renders this, so a
 * sync looks the same whether a button, the agent or a terminal started it.
 */
export const syncActivitySchema = z.discriminatedUnion( 'kind', [
	z.object( {
		kind: z.literal( 'pending' ),
		direction: syncDirectionSchema,
		message: z.string().optional(),
		progress: z.number().optional(),
		// How far a push has got; gates cancelling it (`canCancelPush`).
		phase: z.enum( PUSH_PHASES ).optional(),
		// The CLI logger action behind a pull's message; gates cancelling it (`canCancelPull`).
		action: z.string().optional(),
		// The preview site a preview update is refreshing; absent while creating one.
		hostname: z.string().optional(),
	} ),
	z.object( { kind: z.literal( 'success' ), direction: syncDirectionSchema } ),
	z.object( { kind: z.literal( 'cancelled' ), direction: syncDirectionSchema } ),
	z.object( { kind: z.literal( 'error' ), direction: syncDirectionSchema, message: z.string() } ),
] );

export type SyncActivity = z.infer< typeof syncActivitySchema >;
export type SyncDirection = z.infer< typeof syncDirectionSchema >;

export const syncEventSchema = z.object( {
	siteId: z.string(),
	activity: syncActivitySchema,
} );

export type SyncEvent = z.infer< typeof syncEventSchema >;
