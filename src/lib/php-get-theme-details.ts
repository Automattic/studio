import { z } from 'zod';
import SiteServerProcess from 'src/lib/site-server-process';

export const themeDetailsSchema = z.object( {
	name: z.string().catch( '' ),
	path: z.string(),
	slug: z.string(),
	isBlockTheme: z.boolean(),
	supportsWidgets: z.boolean(),
	supportsMenus: z.boolean(),
} );

export async function phpGetThemeDetails(
	server: SiteServerProcess
): Promise< StartedSiteDetails[ 'themeDetails' ] > {
	if ( ! server.php ) {
		throw Error( 'PHP is not instantiated' );
	}

	const themeDetailsPhp = `<?php
	require_once('${ server.php.documentRoot }/wp-load.php');
	$theme = wp_get_theme();
	echo json_encode([
		'name' => $theme->get('Name'),
		'path' => $theme->get_stylesheet_directory(),
		'slug' => $theme->get_stylesheet(),
		'isBlockTheme' => $theme->is_block_theme(),
		'supportsWidgets' => current_theme_supports('widgets'),
		'supportsMenus' => get_registered_nav_menus() || current_theme_supports('menus'),
	]);
	`;

	try {
		const themeDetailsRaw = await server.runPhp( {
			code: themeDetailsPhp,
		} );
		const themeDetailsParsed = JSON.parse( themeDetailsRaw );
		return themeDetailsSchema.parse( themeDetailsParsed );
	} catch ( error ) {
		return undefined;
	}
}
