import { z } from 'zod';

export const hostManifestSchema = z
	.object( {
		id: z.string().min( 1 ),
		name: z.string().min( 1 ),
		sites: z.object( { listKey: z.string().min( 1 ) } ).strict(),
		describeSite: z.string().min( 1 ),
		driver: z.object( { type: z.string().min( 1 ) } ).passthrough(),
	} )
	.strict();

export type HostManifest = z.infer< typeof hostManifestSchema >;
