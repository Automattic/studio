// WordPress.com screenshot service used for remote-site thumbnails.
export function getMshotUrl( siteUrl: string ): string {
	return `https://s0.wp.com/mshots/v1/${ encodeURIComponent( siteUrl ) }?w=600&h=400`;
}
