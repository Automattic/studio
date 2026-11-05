import { z } from 'zod';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import type { StandingPreview } from '@studio/common/types/sync';

const standingPreviewsSchema = z.object( {
	preview_sites: z
		.array(
			z.object( {
				blog_id: z.number(),
				site_slug: z.string().optional(),
				expires_at: z.number().optional(),
				share_url: z.string().optional(),
			} )
		)
		.optional(),
} );

/**
 * The user's previews WordPress.com still has standing (unpaid and not torn down), by site ID. A
 * preview that was bought, expired or deleted elsewhere is not among them.
 */
export async function getStandingPreviews(
	token: string
): Promise< Map< number, StandingPreview > > {
	const response = standingPreviewsSchema.parse(
		await wpcomFactory( token, wpcomXhrRequest ).req.get( {
			apiNamespace: 'wpcom/v2',
			path: '/wow-funnel/pending',
		} )
	);
	return new Map(
		( response.preview_sites ?? [] ).map( ( site ) => [
			site.blog_id,
			{
				hostname: site.share_url ? new URL( site.share_url ).hostname : site.site_slug,
				expiresAt: site.expires_at === undefined ? undefined : site.expires_at * 1000,
				shareUrl: site.share_url || undefined,
			},
		] )
	);
}
