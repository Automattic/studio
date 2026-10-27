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
 */
import { readWordPressSite } from 'cli/ai/site-database';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import type { SiteChangeSource, Versions } from 'cli/ai/site-changes';
import type { SiteData } from 'cli/lib/cli-config/core';

const UNFLAGGED = 'unflagged:';

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

async function save( site: SiteData, id: number ): Promise< string | undefined > {
	try {
		await connectToDaemon();
		await using command = await runWpCliCommand( site, [ 'eval', resave( id ) ] );
		const output = await command.response.stdoutText;
		const { status, message } = JSON.parse( output.slice( output.indexOf( '{' ) ) ) as {
			status: number | string;
			message?: string;
		};
		return status === 200 ? undefined : message || String( status );
	} catch ( error ) {
		return error instanceof Error ? error.message : String( error );
	} finally {
		await disconnectFromDaemon();
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
			for ( const { id, modified, content } of site.query< {
				id: number;
				modified: string;
				content: string;
			} >(
				`SELECT ID AS id, post_modified_gmt AS modified, post_content AS content FROM ${ site.prefix }posts WHERE post_type = 'wp_global_styles'`
			) ) {
				versions[ id ] = `${ flagged( content ) ? '' : UNFLAGGED }${ modified }:${
					content.length
				}`;
			}
			return versions;
		} );
	},
	async check( site, before, after ) {
		const reports = [];
		for ( const [ id, version ] of Object.entries( after ) ) {
			if ( version === before[ id ] || ! version.startsWith( UNFLAGGED ) ) {
				continue;
			}
			const failed = await save( site, Number( id ) );
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
