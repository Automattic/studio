import { z } from 'zod';

export const wpcomConfigSchema = z.object( { token: z.string().min( 1 ) } );

export type WpcomConfig = z.infer< typeof wpcomConfigSchema >;
