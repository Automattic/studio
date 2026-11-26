import { z } from 'zod';
import { pickedModelsSchema } from '../picked-models';

export const metaConfigSchema = z.object( {
	apiKey: z.string().min( 1 ),
	models: pickedModelsSchema,
} );

export type MetaConfig = z.infer< typeof metaConfigSchema >;
