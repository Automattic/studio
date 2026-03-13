/**
 * Plugin installer for benchmark sites via the WordPress REST API.
 *
 * Reads plugin slugs from the shared plugins-blueprint.json
 * (single source of truth for all environments).
 *
 * Flow: wp-login.php → nonce extraction → POST /wp-json/wp/v2/plugins
 */

/* eslint-disable no-console */

import fs from 'fs';
import chalk from 'chalk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BlueprintStep {
	step: string;
	pluginData?: {
		resource: string;
		slug: string;
	};
}

interface Blueprint {
	steps: BlueprintStep[];
}

// ---------------------------------------------------------------------------
// Blueprint parsing
// ---------------------------------------------------------------------------

/**
 * Parse the blueprint JSON to extract plugin slugs.
 * This is the single source of truth for which plugins to install across
 * all environments (Studio, Playground CLI, Playground Web, custom).
 */
export function getPluginSlugsFromBlueprint( blueprintPath: string ): string[] {
	const blueprint: Blueprint = JSON.parse( fs.readFileSync( blueprintPath, 'utf-8' ) );
	return blueprint.steps
		.filter( ( step ) => step.step === 'installPlugin' && step.pluginData?.slug )
		.map( ( step ) => step.pluginData!.slug );
}

// ---------------------------------------------------------------------------
// WordPress REST API helpers
// ---------------------------------------------------------------------------

/**
 * Log in to WordPress via wp-login.php and return the auth cookies.
 */
async function wpLogin( siteUrl: string, username: string, password: string ): Promise< string > {
	const loginUrl = `${ siteUrl }/wp-login.php`;
	const body = new URLSearchParams( {
		log: username,
		pwd: password,
		'wp-submit': 'Log In',
		redirect_to: '/wp-admin/',
		testcookie: '1',
	} );

	const response = await fetch( loginUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Cookie: 'wordpress_test_cookie=WP%20Cookie%20check',
		},
		body: body.toString(),
		redirect: 'manual',
	} );

	const setCookieHeaders = response.headers.getSetCookie();
	const cookies = setCookieHeaders
		.map( ( header ) => header.split( ';' )[ 0 ] )
		.filter( ( c ) => c.startsWith( 'wordpress_' ) );

	if ( cookies.length === 0 ) {
		throw new Error(
			`WordPress login failed: no auth cookies returned (HTTP ${ response.status })`
		);
	}

	return cookies.join( '; ' );
}

/**
 * Extract the WP REST API nonce from the wp-admin page.
 */
async function extractNonce( siteUrl: string, cookies: string ): Promise< string > {
	const response = await fetch( `${ siteUrl }/wp-admin/`, {
		headers: { Cookie: cookies },
		redirect: 'follow',
	} );

	const html = await response.text();
	const match = html.match( /var\s+wpApiSettings\s*=\s*(\{[^;]+\});/ );
	if ( ! match ) {
		throw new Error( 'Could not extract wpApiSettings nonce from wp-admin' );
	}

	const settings = JSON.parse( match[ 1 ] );
	if ( ! settings.nonce ) {
		throw new Error( 'wpApiSettings found but nonce is missing' );
	}

	return settings.nonce as string;
}

/**
 * Install and activate a single plugin via the WP REST API.
 */
async function installPlugin(
	siteUrl: string,
	cookies: string,
	nonce: string,
	slug: string
): Promise< void > {
	const response = await fetch( `${ siteUrl }/wp-json/wp/v2/plugins`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Cookie: cookies,
			'X-WP-Nonce': nonce,
		},
		body: JSON.stringify( { slug, status: 'active' } ),
	} );

	if ( ! response.ok ) {
		const body = await response.text();
		let json: { code?: string } | null = null;
		try {
			json = JSON.parse( body );
		} catch {
			// Not JSON, fall through to throw
		}
		if ( json?.code === 'folder_exists' ) {
			console.log( chalk.gray( `        ${ slug } already installed, skipping` ) );
			return;
		}
		throw new Error( `HTTP ${ response.status }: ${ body.slice( 0, 200 ) }` );
	}
}

// ---------------------------------------------------------------------------
// Plugin installation
// ---------------------------------------------------------------------------

/**
 * Installs and activates plugins on a WordPress site using the REST API.
 *
 * Reads plugin slugs from the provided blueprint file (the same file used
 * for Studio and Playground environments), logs in via wp-login.php,
 * extracts a REST API nonce, and installs each plugin via
 * POST /wp-json/wp/v2/plugins.
 *
 * @param siteUrl - The site's base URL (e.g., http://localhost:10003)
 * @param blueprintPath - Path to plugins-blueprint.json
 * @param username - WordPress admin username
 * @param password - WordPress admin password
 */
export async function installPlugins(
	siteUrl: string,
	blueprintPath: string,
	username: string,
	password: string
): Promise< void > {
	const slugs = getPluginSlugsFromBlueprint( blueprintPath );
	if ( slugs.length === 0 ) {
		console.log( chalk.yellow( '      No plugins found in blueprint' ) );
		return;
	}

	console.log( chalk.gray( `      Logging in to WordPress...` ) );
	const cookies = await wpLogin( siteUrl, username, password );

	console.log( chalk.gray( `      Extracting REST API nonce...` ) );
	const nonce = await extractNonce( siteUrl, cookies );

	console.log( chalk.gray( `      Installing ${ slugs.length } plugins via REST API...` ) );

	for ( const slug of slugs ) {
		try {
			console.log( chalk.gray( `        ${ slug }...` ) );
			await installPlugin( siteUrl, cookies, nonce, slug );
		} catch ( err ) {
			const message = err instanceof Error ? err.message : String( err );
			console.warn( chalk.yellow( `        Failed to install ${ slug }: ${ message }` ) );
			// Continue with remaining plugins
		}
	}
}
