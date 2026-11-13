import { z } from 'zod';

export const spacefastConfigSchema = z.object( {
	apiKey: z.string().min( 1 ),
	// When the key stops working, or null when it doesn't expire.
	expiresAt: z.string().nullable().optional(),
} );

export type SpacefastConfig = z.infer< typeof spacefastConfigSchema >;
