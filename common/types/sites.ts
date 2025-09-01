import { z } from 'zod';

export const siteSchema = z
	.object( {
		id: z.string(),
		path: z.string(),
		name: z.string(),
		port: z.number().optional(),
		running: z.boolean().optional(),
		phpVersion: z.string().optional(),
		pid: z.number().optional(),
		url: z.string().optional(),
		customDomain: z.string().optional(),
		enableHttps: z.boolean().optional(),
		isWpAutoUpdating: z.boolean().optional(),
		adminPassword: z.string().optional(),
	} )
	.passthrough();

export type SiteDetails = z.infer< typeof siteSchema >;
