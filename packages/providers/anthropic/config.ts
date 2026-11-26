import { z } from 'zod';
import { pickedModelsSchema } from '../picked-models';

export const anthropicConfigSchema = z.discriminatedUnion( 'method', [
	z.object( {
		method: z.literal( 'api-key' ),
		apiKey: z.string().min( 1 ),
		models: pickedModelsSchema,
	} ),
	// A long-lived token from `claude setup-token`, billed to the Claude subscription.
	z.object( {
		method: z.literal( 'setup-token' ),
		token: z.string().min( 1 ),
		models: pickedModelsSchema,
	} ),
] );

export type AnthropicConfig = z.infer< typeof anthropicConfigSchema >;
