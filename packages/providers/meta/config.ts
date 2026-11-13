import { z } from 'zod';

export const metaConfigSchema = z.discriminatedUnion( 'method', [
	// A Muse subscription sign-in: Meta's identity token mints a Model API key that lasts about a
	// day, billed to the subscription.
	z.object( {
		method: z.literal( 'subscription' ),
		identityToken: z.string().min( 1 ),
		apiKey: z.string().min( 1 ),
		apiKeyExpiresAt: z.number(),
	} ),
	z.object( { method: z.literal( 'api-key' ), apiKey: z.string().min( 1 ) } ),
] );

export type MetaConfig = z.infer< typeof metaConfigSchema >;
