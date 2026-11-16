import { z } from 'zod';

export const geminiConfigSchema = z.object( {
	method: z.literal( 'api-key' ),
	apiKey: z.string().min( 1 ),
} );

export type GeminiConfig = z.infer< typeof geminiConfigSchema >;
