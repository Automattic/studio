import { z } from 'zod';

// Both methods end in an OpenRouter API key: signing in has OpenRouter create
// one for Studio, which doesn't expire.
export const openrouterConfigSchema = z.object( {
	method: z.enum( [ 'sign-in', 'api-key' ] ),
	apiKey: z.string().min( 1 ),
} );

export type OpenrouterConfig = z.infer< typeof openrouterConfigSchema >;
