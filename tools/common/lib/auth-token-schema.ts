import { z } from 'zod';

export const authTokenSchema = z.object( {
	accessToken: z.string(),
	expiresIn: z.number(),
	expirationTime: z.number(),
	id: z.number(),
	email: z.string(),
	displayName: z.string().default( '' ),
} );

export type StoredAuthToken = z.infer< typeof authTokenSchema >;
