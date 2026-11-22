import { z } from 'zod';

export const wpcomConfigSchema = z.object( {
	token: z.string().min( 1 ),
	// When the token stops working, in milliseconds since the epoch.
	expiresAt: z.number().optional(),
	// The account the token belongs to, Studio's signed-in user.
	user: z.object( { id: z.number(), email: z.string(), displayName: z.string() } ).optional(),
} );

export type WpcomConfig = z.infer< typeof wpcomConfigSchema >;
