import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve( fileURLToPath( import.meta.url ), '../../..' );
