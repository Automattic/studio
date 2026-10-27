/**
 * A site's look is the user's choice. A theme WordPress updates is shipped for
 * every site that uses it, so a site whose front page is built on one, with no
 * Global Styles of its own, looks as that theme ships for everyone. When a
 * turn leaves a site so, Studio asks the user which look it should have,
 * offering the theme's default and the style variations the Site Editor's
 * Styles offers, or one of the user's own; a variation picked is saved as
 * the Site Editor saves it.
 */
import { readSavedCopies } from 'cli/ai/saved-copies';
import { readWordPressSite } from 'cli/ai/site-database';
import { STYLE_VARIATIONS, themePresets } from 'cli/ai/theme-presets';
import { activeThemes, isUpdatableTheme, readThemeHeader } from 'cli/ai/themes';
import { resolveSite } from 'cli/ai/tools/utils';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import type { AskUserQuestion } from 'cli/ai/types';

/** A question a site's state asks the user, by the state it asks of. */
export interface SiteQuestion {
	key: string;
	/** The question, and what the turn is told of an answer, or undefined when nothing follows. */
	prepare: () => Promise< {
		question: AskUserQuestion;
		answered: ( answer: string ) => Promise< string | undefined >;
	} >;
}

// The Site Editor saving a style variation: its settings and styles as the
// site's Global Styles, through the REST route it saves them with
// (WP_REST_Global_Styles_Controller::update_item()), as an administrator.
const applyVariation = ( title: string ) => `${ STYLE_VARIATIONS }
foreach ( style_variations_offered() as $variation ) {
	if ( $variation['title'] !== '${ title.replace( /[\\']/g, '\\$&' ) }' ) {
		continue;
	}
	wp_set_current_user( (int) ( get_users( array( 'role' => 'administrator', 'number' => 1, 'fields' => 'ID' ) )[0] ?? 0 ) );
	$id = WP_Theme_JSON_Resolver::get_user_global_styles_post_id();
	$request = new WP_REST_Request( 'POST', '/wp/v2/global-styles/' . $id );
	$request->set_body_params( array( 'settings' => $variation['settings'] ?? array(), 'styles' => $variation['styles'] ?? array() ) );
	$response = rest_do_request( $request );
	echo wp_json_encode( array( 'id' => $id, 'status' => $response->get_status() ) );
}
`;

async function saveVariation( sitePath: string, title: string ): Promise< number | undefined > {
	const site = await resolveSite( sitePath );
	try {
		await connectToDaemon();
		await using command = await runWpCliCommand( site, [ 'eval', applyVariation( title ) ] );
		const output = await command.response.stdoutText;
		const saved = JSON.parse( output.slice( output.indexOf( '{' ) ) || 'null' ) as {
			id: number;
			status: number;
		} | null;
		return saved?.status === 200 ? saved.id : undefined;
	} catch {
		return undefined;
	} finally {
		await disconnectFromDaemon();
	}
}

/**
 * The look question of a site whose static front page is built on a theme
 * WordPress updates, with no Global Styles saved for it.
 */
export async function lookQuestion( sitePath: string ): Promise< SiteQuestion | undefined > {
	const state = await readWordPressSite( sitePath, ( site ) => {
		const [ theme ] = activeThemes( site );
		const front = Number( site.option( 'page_on_front' ) );
		if (
			! theme ||
			site.option( 'show_on_front' ) !== 'page' ||
			! front ||
			readSavedCopies( site ).some( ( copy ) => copy.postType === 'wp_global_styles' )
		) {
			return undefined;
		}
		return {
			theme,
			front,
			siteName: String( site.option( 'blogname' ) ?? '' ),
		};
	} );
	if ( ! state || ! ( await isUpdatableTheme( sitePath, state.theme ) ) ) {
		return undefined;
	}
	const { theme } = state;
	return {
		key: `look of ${ sitePath } front page ${ state.front } on ${ theme }`,
		prepare: async () => {
			const variations =
				( await readWordPressSite( sitePath, ( site ) => themePresets( site ) ) )
					?.styleVariations ?? [];
			const themeName =
				( await readThemeHeader( sitePath, theme, 'Theme Name' ).catch( () => '' ) ) || theme;
			const keep = `${ themeName } as it ships`;
			const question = `Which look should "${ state.siteName }" have? It is built on ${ themeName }, a theme WordPress updates, with no Global Styles of its own, so it looks as ${ themeName } ships.`;
			return {
				question: {
					question,
					options: [
						{ label: keep, description: `Keeps ${ themeName }'s default look.` },
						...variations.map( ( title ) => ( {
							label: title,
							description: `${ themeName }'s style variation "${ title }", saved as the site's Global Styles, as the Site Editor's Styles saves it.`,
						} ) ),
					],
					allowFreeForm: true,
				},
				answered: async ( answer ) => {
					if ( answer === keep ) {
						return undefined;
					}
					if ( variations.includes( answer ) ) {
						const id = await saveVariation( sitePath, answer );
						return id
							? `The user chose ${ themeName }'s style variation "${ answer }" for "${ state.siteName }", and Studio saved it as the site's Global Styles (wp_global_styles post ${ id }), as the Site Editor's Styles saves it.`
							: `The user chose ${ themeName }'s style variation "${ answer }" for "${ state.siteName }", and Studio could not save it. The Site Editor saves a style variation's settings and styles as the site's Global Styles (WP_REST_Global_Styles_Controller::update_item() in wp-includes/rest-api/endpoints/class-wp-rest-global-styles-controller.php).`;
					}
					return `The user answered "${ answer }" to: ${ question }`;
				},
			};
		},
	};
}
