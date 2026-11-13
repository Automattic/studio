import { z } from 'zod';

export const xaiConfigSchema = z.discriminatedUnion( 'method', [
	// A SuperGrok or X Premium sign-in, billed to that subscription. The refresh
	// token renews the access token, so the config itself doesn't expire.
	z.object( {
		method: z.literal( 'grok' ),
		accessToken: z.string().min( 1 ),
		refreshToken: z.string().min( 1 ),
		accessTokenExpiresAt: z.number(),
	} ),
	z.object( { method: z.literal( 'api-key' ), apiKey: z.string().min( 1 ) } ),
] );

export type XaiConfig = z.infer< typeof xaiConfigSchema >;
