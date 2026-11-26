import { z } from 'zod';
import type { AiModelId } from './models';

// The models the user picked from a provider's catalog; the ones it lists until they pick.
export const pickedModelsSchema = z
	.array(
		z.object( {
			id: z.custom< AiModelId >( ( id ) => typeof id === 'string' ),
			label: z.string(),
		} )
	)
	.optional();

export type PickedModels = { models?: z.infer< typeof pickedModelsSchema > };
