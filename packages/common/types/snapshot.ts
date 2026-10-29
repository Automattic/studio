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
	// When WordPress.com tears the preview down (ms), as it last reported. WordPress.com owns the
	// review window; earlier Jurassic Ninja previews have none.
	expiresAt: z.number().optional(),
} );

export type Snapshot = z.infer< typeof snapshotSchema >;
