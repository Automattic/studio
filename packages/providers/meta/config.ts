import { z } from 'zod';

export const metaConfigSchema = z.object( { apiKey: z.string().min( 1 ) } );

export type MetaConfig = z.infer< typeof metaConfigSchema >;
