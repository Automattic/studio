import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import * as Sentry from '@sentry/electron/renderer';
import { z } from 'zod';
import { withOfflineCheck } from 'src/stores/utils/with-offline-check';

const GALLERY_BASE_URL = 'https://wordpress.github.io/blueprints/';
const GITHUB_RAW_BASE_URL = 'https://raw.githubusercontent.com/WordPress/blueprints/trunk/';
const PLAYGROUND_BASE_URL = 'https://playground.wordpress.net/';

export interface GalleryBlueprint {
	slug: string;
	title: string;
	description: string;
	author: string;
	categories: string[];
	screenshotUrl: string;
	featured: boolean;
	blueprintUrl: string;
	playgroundUrl: string;
}

const galleryIndexEntrySchema = z.object( {
	title: z.string(),
	description: z.string(),
	author: z.string(),
	categories: z.array( z.string() ),
	screenshot_url: z.string(),
	featured: z.boolean(),
} );

const galleryIndexSchema = z.record( z.string(), galleryIndexEntrySchema );

function transformGalleryIndex( raw: unknown ): GalleryBlueprint[] {
	const parseResult = galleryIndexSchema.safeParse( raw );
	if ( ! parseResult.success ) {
		Sentry.captureException( parseResult.error );
		return [];
	}
	return Object.entries( parseResult.data ).flatMap( ( [ path, entry ] ) => {
		// path format: "blueprints/{slug}/blueprint.json"
		const match = path.match( /^blueprints\/([^/]+)\/blueprint\.json$/ );
		if ( ! match ) {
			return [];
		}
		const slug = match[ 1 ];
		const blueprintUrl = `${ GITHUB_RAW_BASE_URL }blueprints/${ slug }/blueprint.json`;
		const playgroundUrl = `${ PLAYGROUND_BASE_URL }?blueprint-url=${ encodeURIComponent(
			blueprintUrl
		) }`;
		return [
			{
				slug,
				title: entry.title || slug,
				description: entry.description,
				author: entry.author,
				categories: entry.categories,
				screenshotUrl: entry.screenshot_url,
				featured: entry.featured,
				blueprintUrl,
				playgroundUrl,
			},
		];
	} );
}

export const galleryBlueprintsApi = createApi( {
	reducerPath: 'galleryBlueprintsApi',
	baseQuery: fetchBaseQuery( { baseUrl: GALLERY_BASE_URL } ),
	endpoints: ( builder ) => ( {
		getGalleryBlueprints: builder.query< GalleryBlueprint[], void >( {
			query: () => 'index.json',
			transformResponse: transformGalleryIndex,
			keepUnusedDataFor: 60 * 60,
		} ),
	} ),
} );

export const useGetGalleryBlueprints = withOfflineCheck(
	galleryBlueprintsApi.useGetGalleryBlueprintsQuery
);
