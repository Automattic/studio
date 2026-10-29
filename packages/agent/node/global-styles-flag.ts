/**
 * Global Styles WordPress applies. WordPress reads a wp_global_styles post only
 * when its JSON carries "isGlobalStylesUserThemeJSON": true, the flag the
 * Site Editor's REST route sets once it has sanitized the content: "If it's
 * not true then the content was not escaped and is not safe"
 * (WP_Theme_JSON_Resolver::get_user_data()). A post saved another way, as
 * `wp post update` does, is ignored, styles and all. When a call leaves such a
 * post, Studio saves its settings and styles again through that route
 * (WP_REST_Global_Styles_Controller::update_item()), which sanitizes them and
 * sets the flag, and says so.
 *
 * WordPress also reads only the newest published post whose wp_theme term
 * names the theme (get_user_data_from_wp_global_styles()). A post saved with no
 * term, as `wp post create` saves it, or as that function saves one under `wp
 * eval`, whose wp_insert_post() keeps a tax_input term only for a user who can
 * assign it (wp-includes/post.php), is never read. Studio gives such a post
 * the active theme when that theme has none yet, and says so; a post holding
 * no styles, as core makes one on each read while the theme has none, changes
 * nothing WordPress applies.
 */
import { readWordPressSite } from '@studio/agent/node/site-database';
import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';
import type { SiteChangeSource, Versions } from '@studio/agent/node/site-changes';

const UNFLAGGED = 'unflagged:';
const UNTHEMED = 'unthemed:';

// Gives the post the active theme, unless it holds no styles, as the post core
// makes on each read of a theme with none, or the theme has a post WordPress reads.
const giveTheme = ( id: number ) => `
$data = json_decode( (string) get_post_field( 'post_content', ${ id } ), true );
if ( empty( $data['settings'] ) && empty( $data['styles'] ) ) {
	echo wp_json_encode( array( 'empty' => true ) );
	return;
}
$theme = get_stylesheet();
$read = get_posts( array( 'post_type' => 'wp_global_styles', 'post_status' => 'publish', 'numberposts' => 1, 'fields' => 'ids', 'tax_query' => array( array( 'taxonomy' => 'wp_theme', 'field' => 'name', 'terms' => $theme ) ) ) );
if ( ! $read ) {
	wp_set_post_terms( ${ id }, $theme, 'wp_theme' );
}
echo wp_json_encode( array( 'theme' => $theme, 'read' => $read[0] ?? null ) );
`;

async function theme(
	host: StudioAgentHost,
	site: HostSite,
	id: number
): Promise< { empty?: true; theme: string; read: number | null } > {
	const { stdout: output } = await host.sites.wpCli( site, [ 'eval', giveTheme( id ) ] );
	return JSON.parse( output.slice( output.indexOf( '{' ) ) );
}

// The Site Editor's save of a post's settings and styles, as an administrator.
const resave = ( id: number ) => `
$data = json_decode( (string) get_post_field( 'post_content', ${ id } ), true );
if ( ! is_array( $data ) ) {
	echo wp_json_encode( array( 'status' => 'not JSON' ) );
	return;
}
wp_set_current_user( (int) ( get_users( array( 'role' => 'administrator', 'number' => 1, 'fields' => 'ID' ) )[0] ?? 0 ) );
$request = new WP_REST_Request( 'POST', '/wp/v2/global-styles/${ id }' );
$request->set_body_params( array( 'settings' => $data['settings'] ?? array(), 'styles' => $data['styles'] ?? array() ) );
$response = rest_do_request( $request );
echo wp_json_encode( array( 'status' => $response->get_status(), 'message' => $response->is_error() ? $response->as_error()->get_error_message() : '' ) );
`;

async function save(
	host: StudioAgentHost,
	site: HostSite,
	id: number
): Promise< string | undefined > {
	try {
		const { stdout: output } = await host.sites.wpCli( site, [ 'eval', resave( id ) ] );
		const { status, message } = JSON.parse( output.slice( output.indexOf( '{' ) ) ) as {
			status: number | string;
			message?: string;
		};
		return status === 200 ? undefined : message || String( status );
	} catch ( error ) {
		return error instanceof Error ? error.message : String( error );
	}
}

function flagged( content: string ): boolean {
	try {
		const data = JSON.parse( content ) as { isGlobalStylesUserThemeJSON?: unknown };
		return Boolean( data?.isGlobalStylesUserThemeJSON );
	} catch {
		return false;
	}
}

export const globalStylesFlag: SiteChangeSource = {
	name: 'global-styles-flag',
	saves: true,
	async read( sitePath ) {
		return readWordPressSite( sitePath, ( site ) => {
			const versions: Versions = {};
			for ( const { id, modified, content, themed } of site.query< {
				id: number;
				modified: string;
				content: string;
				themed: number;
			} >(
				`SELECT p.ID AS id, p.post_modified_gmt AS modified, p.post_content AS content,
				EXISTS ( SELECT 1 FROM ${ site.prefix }term_relationships r JOIN ${ site.prefix }term_taxonomy x ON x.term_taxonomy_id = r.term_taxonomy_id AND x.taxonomy = 'wp_theme' WHERE r.object_id = p.ID ) AS themed
				FROM ${ site.prefix }posts p WHERE p.post_type = 'wp_global_styles'`
			) ) {
				versions[ id ] = `${ themed ? '' : UNTHEMED }${
					flagged( content ) ? '' : UNFLAGGED
				}${ modified }:${ content.length }`;
			}
			return versions;
		} );
	},
	async check( site, before, after, host ) {
		const reports = [];
		for ( const [ id, version ] of Object.entries( after ) ) {
			if ( version === before[ id ] ) {
				continue;
			}
			if ( version.startsWith( UNTHEMED ) ) {
				const given = await theme( host, site, Number( id ) ).catch( () => undefined );
				if ( given?.empty ) {
					continue;
				}
				const unread = `WordPress ignores Global Styles post ${ id }: it names no theme, and WordPress reads the newest published post whose wp_theme term names the active theme (get_user_data_from_wp_global_styles() in wp-includes/class-wp-theme-json-resolver.php)`;
				if ( ! given || given.read ) {
					reports.push( {
						key: `global styles ${ id }`,
						problem: given
							? `${ unread }; for ${ given.theme } that is post ${ given.read }. Make the change there, with POST /wp/v2/global-styles/${ given.read } as the Site Editor saves it (WP_REST_Global_Styles_Controller::update_item()), and delete post ${ id }.`
							: `${ unread }. Give it the theme it is for with \`wp post term set ${ id } wp_theme <theme>\`.`,
					} );
					continue;
				}
				reports.push( {
					key: `global styles theme ${ id }`,
					summary: `${ unread }. Studio gave it the active theme, ${ given.theme }, which had none, as core does when it creates the post for a user who can assign the term, so WordPress reads it now.`,
				} );
			}
			if ( ! version.replace( UNTHEMED, '' ).startsWith( UNFLAGGED ) ) {
				continue;
			}
			const failed = await save( host, site, Number( id ) );
			const ignored = `WordPress ignores Global Styles post ${ id }: its JSON has no "isGlobalStylesUserThemeJSON": true, which WordPress reads only once its REST route has sanitized the content (WP_Theme_JSON_Resolver::get_user_data() in wp-includes/class-wp-theme-json-resolver.php)`;
			reports.push(
				failed
					? {
							key: `global styles ${ id }`,
							problem: `${ ignored }, and saving it through that route failed: ${ failed }. The Site Editor saves Global Styles with POST /wp/v2/global-styles/${ id } (WP_REST_Global_Styles_Controller::update_item()), its settings and styles as the body.`,
					  }
					: {
							key: `global styles ${ id }`,
							summary: `${ ignored }. Studio saved its settings and styles through that route, as the Site Editor saves them (WP_REST_Global_Styles_Controller::update_item()), so WordPress applies them now.`,
					  }
			);
		}
		return { reports };
	},
};
