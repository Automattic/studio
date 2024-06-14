import * as Sentry from '@sentry/electron/main';
import SiteServerProcess from './site-server-process';

export async function runArbitraryPhpCode(
	server: SiteServerProcess,
	phpCode: string
): Promise< unknown > {
	if ( ! server.php ) {
		throw Error( 'PHP is not instantiated' );
	}

	let result = null;
	try {
		result = await server.runPhp( {
			code: phpCode,
		} );
		result = JSON.parse( result );
	} catch ( error ) {
		Sentry.captureException( error, {
			extra: { result },
		} );
		result = null;
	}
	return result;
}

export async function phpGetThemeDetails(
	server: SiteServerProcess
): Promise< StartedSiteDetails[ 'themeDetails' ] > {
	if ( ! server.php ) {
		throw Error( 'PHP is not instantiated' );
	}

	const phpCode = `
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

	return runArbitraryPhpCode( server, phpCode ) as Promise< StartedSiteDetails[ 'themeDetails' ] >;
}

export async function phpGetAllPlugins( server: SiteServerProcess ): Promise< unknown > {
	if ( ! server.php ) {
		throw Error( 'PHP is not instantiated' );
	}
	const phpCode = `
		require_once('${ server.php.documentRoot }/wp-load.php');
		$plugins = get_plugins();
		echo json_encode($plugins);
	`;

	return runArbitraryPhpCode( server, phpCode );
}

export async function phpGetAllThemes( server: SiteServerProcess ): Promise< unknown > {
	if ( ! server.php ) {
		throw Error( 'PHP is not instantiated' );
	}
	const phpCode = `
		require_once('${ server.php.documentRoot }/wp-load.php');
		$themes = wp_get_themes();
		echo json_encode($themes);
	`;

	return runArbitraryPhpCode( server, phpCode );
}
