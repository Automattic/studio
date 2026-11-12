import { z } from 'zod';

export const openaiConfigSchema = z.object( {
	method: z.literal( 'chatgpt' ),
	// The OAuth client OpenAI registered for this sign-in.
	clientId: z.string().min( 1 ),
	accessToken: z.string().min( 1 ),
	refreshToken: z.string().min( 1 ),
	// When the access token stops working; the refresh token renews it, so the
	// config itself doesn't expire.
	accessTokenExpiresAt: z.number(),
	email: z.string().optional(),
} );

export type OpenaiConfig = z.infer< typeof openaiConfigSchema >;
