/**
 * A theme's Global Styles: the wp_global_styles post WordPress merges over its
 * theme.json, which it reads only when its JSON carries
 * "isGlobalStylesUserThemeJSON": true, and only the newest published one
 * whose wp_theme term names the theme
 * (WP_Theme_JSON_Resolver::get_user_data_from_wp_global_styles()).
 */
import { savedPosts, type SavedPost } from '@studio/agent/node/saved-copies';
import { AS_ADMINISTRATOR, wpEvalJson } from '@studio/agent/node/tools/utils';
import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';
import type { WordPressSite } from '@studio/agent/node/site-database';

export const GLOBAL_STYLES = 'wp_global_styles';

/** The Global Styles post WordPress reads for `theme`, read from an open site's database. */
export function themeGlobalStyles( site: WordPressSite, theme: string ): SavedPost | undefined {
	return savedPosts( site, theme ).find( ( post ) => post.postType === GLOBAL_STYLES );
}

/**
 * Saves Global Styles as the Site Editor saves them: a PUT of their settings
 * and styles to /wp/v2/global-styles/<ID> as an administrator, whose controller
 * sanitizes them, keeps isGlobalStylesUserThemeJSON and the schema version, and
 * validates custom CSS (WP_REST_Global_Styles_Controller::update_item()). What
 * `data` leaves out, it clears. `post` and `data` are PHP expressions: the
 * post's ID, and the decoded JSON to save. Returns why WordPress refused, or
 * undefined once saved.
 */
export async function saveGlobalStyles(
	host: StudioAgentHost,
	site: HostSite,
	post: string,
	data: string
): Promise< string | undefined > {
	const php = `$data = ${ data };
if ( ! is_array( $data ) ) { echo wp_json_encode( array( 'refused' => 'it is not a JSON object' ) ); return; }
${ AS_ADMINISTRATOR }
$request = new WP_REST_Request( 'PUT', '/wp/v2/global-styles/' . ( ${ post } ) );
$request->set_body_params( array( 'settings' => $data['settings'] ?? array(), 'styles' => $data['styles'] ?? array() ) );
$response = rest_do_request( $request );
echo wp_json_encode( array( 'refused' => $response->is_error() ? $response->as_error()->get_error_message() : null ) );`;
	const { refused } = await wpEvalJson< { refused: string | null } >( host, site, php );
	return refused ?? undefined;
}
