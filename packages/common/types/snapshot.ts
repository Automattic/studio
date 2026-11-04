import { z } from 'zod';

export const snapshotSchema = z.object( {
	url: z.string(),
	atomicSiteId: z.number(),
	localSiteId: z.string(),
	tracksId: z.string().optional(),
	date: z.number(),
	name: z.string().optional(),
	userId: z.number().optional(),
	sequence: z.number().optional(),
	// The preview link that opens the private site for anyone.
	shareUrl: z.string().optional(),
	// When WordPress.com tears the preview down (ms), as it last reported. WordPress.com owns the
	// review window; earlier Jurassic Ninja previews have none.
	expiresAt: z.number().optional(),
	// The local site version the preview holds, as recorded when Studio last pushed to it or pulled
	// from it. See `cli/lib/site-versions`.
	versionId: z.string().optional(),
} );

export type Snapshot = z.infer< typeof snapshotSchema >;
