import { z } from 'zod';

// Keep provider, model, and effort values as strings so preferences created by
// a newer build survive when an older build cannot offer that preset.
export const modelFavoritesSchema = z
	.array(
		z.object( {
			provider: z.string().min( 1 ).max( 256 ),
			model: z.string().min( 1 ).max( 512 ),
			effort: z.string().min( 1 ).max( 64 ),
		} )
	)
	.max( 200 );

export type ModelFavorite = z.infer< typeof modelFavoritesSchema >[ number ];

export function getModelFavoriteKey( favorite: ModelFavorite ): string {
	return JSON.stringify( [ favorite.provider, favorite.model, favorite.effort ] );
}
