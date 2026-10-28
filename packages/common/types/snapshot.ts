import { z } from 'zod';

export const snapshotSchema = z.object( {
	url: z.string(),
	atomicSiteId: z.number(),
	localSiteId: z.string(),
	date: z.number(),
	name: z.string().optional(),
	userId: z.number().optional(),
	sequence: z.number().optional(),
	// The preview link that opens the private site for anyone.
	shareUrl: z.string().optional(),
} );

export type Snapshot = z.infer< typeof snapshotSchema >;
