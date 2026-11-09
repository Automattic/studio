import { z } from 'zod';

export const AI_EFFORT_LEVELS = [ 'default', 'low', 'medium', 'high', 'xhigh', 'max' ] as const;
export type AiEffort = ( typeof AI_EFFORT_LEVELS )[ number ];

export const modelFavoritesSchema = z
	.array(
		z.object( {
			provider: z.string().min( 1 ).max( 256 ),
			model: z.string().min( 1 ).max( 512 ),
			effort: z.enum( AI_EFFORT_LEVELS ),
		} )
	)
	.max( 200 );

export type ModelFavorite = z.infer< typeof modelFavoritesSchema >[ number ];

export function getModelFavoriteKey( favorite: ModelFavorite ): string {
	return JSON.stringify( [ favorite.provider, favorite.model, favorite.effort ] );
}
