import { z } from 'zod';

export const databaseEngineSchema = z.enum( [ 'sqlite', 'mysql' ] );
export type DatabaseEngine = z.infer< typeof databaseEngineSchema >;
