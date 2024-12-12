import * as Sentry from '@sentry/electron/main';
import SiteServerProcess from './site-server-process';

export async function phpGetThemeDetails(
	server: SiteServerProcess
): Promise< StartedSiteDetails[ 'themeDetails' ] > {
	if ( ! server.php ) {
		throw Error( 'PHP is not instantiated' );
	}

	let themeDetails = null;
	const themeDetailsPhp = `<?php
    require_once('${ server.php.documentRoot }/wp-load.php');
    $theme = wp_get_theme();
    echo json_encode([
        'name' => $theme->get('Name'),
        'uri' => $theme->get('ThemeURI'),
        'path' => $theme->get_stylesheet_directory(),
        'slug' => $theme->get_stylesheet(),
		'isBlockTheme' => $theme->is_block_theme(),
		'supportsWidgets' => current_theme_supports('widgets'),
		'supportsMenus' => get_registered_nav_menus() || current_theme_supports('menus'),
    ]);
    `;
	try {
		themeDetails = await server.runPhp( {
			code: themeDetailsPhp,
		} );
		themeDetails = JSON.parse( themeDetails );
	} catch ( error ) {
		Sentry.captureException( error, {
			extra: { themeDetails },
		} );
		themeDetails = null;
	}
	return themeDetails;
}
