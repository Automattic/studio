import { z } from 'zod';

// An AI endpoint the user connected: where it is, the API it answered in when
// connected, its key, the name it gives the model and whether the model takes images.
export const customConfigSchema = z.object( {
	baseUrl: z.string(),
	api: z.enum( [ 'openai-completions', 'anthropic-messages' ] ),
	apiKey: z.string().min( 1 ),
	model: z.string().min( 1 ),
	images: z.boolean(),
} );

export type CustomConfig = z.infer< typeof customConfigSchema >;
