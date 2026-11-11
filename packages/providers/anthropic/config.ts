import { z } from 'zod';

export const anthropicConfigSchema = z.object( {
	method: z.literal( 'api-key' ),
	apiKey: z.string().min( 1 ),
} );

export type AnthropicConfig = z.infer< typeof anthropicConfigSchema >;
