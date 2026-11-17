/**
 * A page of a site as its server renders it for a visitor.
 */

// A post ID no site has, so WordPress renders its 404 template, which shows
// the header and footer as every page does (WP_Query sets is_404).
export const NOT_FOUND = '?p=2147483647';

export async function render( url: string ): Promise< string | undefined > {
	const response = await fetch( url, { signal: AbortSignal.timeout( 10_000 ) } ).catch(
		() => undefined
	);
	return response?.text().catch( () => undefined );
}
