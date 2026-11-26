import { z } from 'zod';
import { pickedModelsSchema } from '../picked-models';

export const geminiConfigSchema = z.object( {
	method: z.literal( 'api-key' ),
	apiKey: z.string().min( 1 ),
	models: pickedModelsSchema,
} );

export type GeminiConfig = z.infer< typeof geminiConfigSchema >;
