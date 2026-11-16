import { z } from 'zod';

export const openaiConfigSchema = z.discriminatedUnion( 'method', [
	z.object( {
		method: z.literal( 'chatgpt' ),
		// The OAuth client OpenAI registered for this sign-in.
		clientId: z.string().min( 1 ),
		accessToken: z.string().min( 1 ),
		refreshToken: z.string().min( 1 ),
		// When the access token stops working; the refresh token renews it, so the
		// config itself doesn't expire.
		accessTokenExpiresAt: z.number(),
		email: z.string().optional(),
	} ),
	z.object( { method: z.literal( 'api-key' ), apiKey: z.string().min( 1 ) } ),
] );

export type OpenaiConfig = z.infer< typeof openaiConfigSchema >;

export type ChatgptConfig = Extract< OpenaiConfig, { method: 'chatgpt' } >;
