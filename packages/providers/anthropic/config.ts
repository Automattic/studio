import { z } from 'zod';

export const anthropicConfigSchema = z.discriminatedUnion( 'method', [
	z.object( { method: z.literal( 'api-key' ), apiKey: z.string().min( 1 ) } ),
	// A long-lived token from `claude setup-token`, billed to the Claude subscription.
	z.object( { method: z.literal( 'setup-token' ), token: z.string().min( 1 ) } ),
] );

export type AnthropicConfig = z.infer< typeof anthropicConfigSchema >;
