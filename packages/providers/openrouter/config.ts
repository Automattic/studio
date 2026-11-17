import { z } from 'zod';

// A model picked from OpenRouter's catalog, with what running it needs.
const pickedModelSchema = z.object( {
	// OpenRouter's name for it, such as `moonshotai/kimi-k3`.
	slug: z.string().min( 1 ),
	label: z.string(),
	images: z.boolean(),
	reasoning: z.boolean(),
	contextWindow: z.number(),
	maxTokens: z.number().optional(),
} );

// Both methods end in an OpenRouter API key: signing in has OpenRouter create
// one for Studio, which doesn't expire.
export const openrouterConfigSchema = z.object( {
	method: z.enum( [ 'sign-in', 'api-key' ] ),
	apiKey: z.string().min( 1 ),
	// The models the user picked; the ones Studio lists until they pick.
	models: z.array( pickedModelSchema ).optional(),
} );

export type OpenrouterConfig = z.infer< typeof openrouterConfigSchema >;
export type OpenrouterPickedModel = z.infer< typeof pickedModelSchema >;
