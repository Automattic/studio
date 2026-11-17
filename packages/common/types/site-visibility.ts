import { z } from 'zod';

export const siteVisibilitySchema = z.enum( [ 'public', 'coming-soon', 'private' ] );
