import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const CLI_DIR = process.env.STUDIO_CLI_DIST_DIR
	? path.resolve( process.env.STUDIO_CLI_DIST_DIR )
	: path.resolve( __dirname, '../apps/cli/dist/cli' );
const CLI_PATH = path.join( CLI_DIR, 'main.mjs' );
const TEMPLATE_PATH = path.join( CLI_DIR, 'wp-files/preinstalled-sqlite/latest/.ht.sqlite' );
const SESSION_PATH = path.join(
	'/tmp',
	`studio-preinstalled-sqlite-${ process.pid }-${ Date.now() }`
);
const TEMPLATE_BACKUP_PATH = path.join( SESSION_PATH, 'previous-template.ht.sqlite' );
const GENERATED_SITE_PATH = path.join( SESSION_PATH, 'generated-site' );
const VALIDATION_SITE_PATH = path.join( SESSION_PATH, 'validation-site' );
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'password';
const ADMIN_EMAIL = 'admin@localhost.com';

function commandEnv() {
	return {
		...process.env,
		E2E: 'true',
		E2E_CLI_CONFIG_PATH: path.join( SESSION_PATH, 'cliConfig' ),
		E2E_SHARED_CONFIG_PATH: path.join( SESSION_PATH, 'sharedConfig' ),
		HOME: path.join( SESSION_PATH, 'home' ),
	};
}

function runCli( args: string[], options: { allowFailure?: boolean } = {} ) {
	const result = spawnSync( process.execPath, [ CLI_PATH, ...args ], {
		env: commandEnv(),
		encoding: 'utf8',
		stdio: 'pipe',
		timeout: 420_000,
	} );

	if ( result.error ) {
		throw result.error;
	}

	if ( result.status !== 0 && ! options.allowFailure ) {
		throw new Error(
			`studio ${ args.join( ' ' ) } failed with exit ${ result.status }:\n${ result.stderr.slice(
				-4000
			) }`
		);
	}

	return result;
}

function createSite( sitePath: string, siteName: string ) {
	runCli( [
		'site',
		'create',
		'--name',
		siteName,
		'--path',
		sitePath,
		'--wp',
		'latest',
		'--php',
		'8.3',
		'--admin-username',
		ADMIN_USERNAME,
		'--admin-password',
		ADMIN_PASSWORD,
		'--admin-email',
		ADMIN_EMAIL,
		'--skip-browser',
		'--skip-log-details',
	] );
}

function stopSite( sitePath: string ) {
	runCli( [ 'site', 'stop', '--path', sitePath ], { allowFailure: true } );
}

function parseJsonObject( text: string ) {
	const start = text.indexOf( '{' );
	const end = text.lastIndexOf( '}' );
	if ( start === -1 || end === -1 || end < start ) {
		throw new Error( `Expected JSON object in command output:\n${ text.slice( -1000 ) }` );
	}
	return JSON.parse( text.slice( start, end + 1 ) );
}

function siteStatus( sitePath: string ) {
	const result = runCli( [ 'site', 'status', '--path', sitePath, '--format', 'json' ] );
	return parseJsonObject( result.stdout );
}

function wpEvalJson( sitePath: string, code: string ) {
	const result = runCli( [ 'wp', '--path', sitePath, 'eval', `echo wp_json_encode(${ code });` ] );
	return parseJsonObject( result.stdout );
}

async function assertWpAdminDoesNotRequireUpgrade( siteUrl: string ) {
	const response = await fetch( new URL( '/wp-admin/', siteUrl ), {
		signal: AbortSignal.timeout( 30_000 ),
	} );
	if ( response.url.includes( '/wp-admin/upgrade.php' ) ) {
		throw new Error( `Generated template requires a database upgrade: ${ response.url }` );
	}
	if ( response.status < 200 || response.status >= 400 ) {
		throw new Error( `wp-admin returned HTTP ${ response.status }: ${ response.url }` );
	}
}

function assertAdminPassword( sitePath: string ) {
	runCli( [ 'wp', '--path', sitePath, 'user', 'check-password', ADMIN_USERNAME, ADMIN_PASSWORD ] );
}

async function validateGeneratedTemplate() {
	createSite( VALIDATION_SITE_PATH, 'Studio Template Validation' );
	const status = siteStatus( VALIDATION_SITE_PATH );
	await assertWpAdminDoesNotRequireUpgrade( status.siteUrl );
	const options = wpEvalJson(
		VALIDATION_SITE_PATH,
		`[
			'home' => get_option('home'),
			'siteurl' => get_option('siteurl'),
			'permalink_structure' => get_option('permalink_structure'),
			'blogname' => get_option('blogname'),
		]`
	);
	if ( options.home !== status.siteUrl.replace( /\/$/, '' ) ) {
		throw new Error( `Generated template did not specialize home: ${ options.home }` );
	}
	if ( options.siteurl !== options.home ) {
		throw new Error( `Generated template home/siteurl mismatch: ${ JSON.stringify( options ) }` );
	}
	if ( options.permalink_structure !== '/%year%/%monthnum%/%day%/%postname%/' ) {
		throw new Error( `Generated template permalink mismatch: ${ JSON.stringify( options ) }` );
	}
	if ( options.blogname !== 'Studio Template Validation' ) {
		throw new Error( `Generated template blogname mismatch: ${ JSON.stringify( options ) }` );
	}
	assertAdminPassword( VALIDATION_SITE_PATH );
}

async function main() {
	if ( ! fs.existsSync( CLI_PATH ) ) {
		throw new Error( `Studio CLI build not found at ${ CLI_PATH }. Run the CLI build first.` );
	}

	fs.mkdirSync( SESSION_PATH, { recursive: true } );
	fs.mkdirSync( path.dirname( TEMPLATE_PATH ), { recursive: true } );

	let hadPreviousTemplate = false;
	try {
		if ( fs.existsSync( TEMPLATE_PATH ) ) {
			hadPreviousTemplate = true;
			fs.renameSync( TEMPLATE_PATH, TEMPLATE_BACKUP_PATH );
		}

		createSite( GENERATED_SITE_PATH, 'Studio Template Seed' );
		const generatedDatabasePath = path.join(
			GENERATED_SITE_PATH,
			'wp-content/database/.ht.sqlite'
		);
		if ( ! fs.existsSync( generatedDatabasePath ) ) {
			throw new Error( `Template database was not created at ${ generatedDatabasePath }` );
		}
		fs.copyFileSync( generatedDatabasePath, TEMPLATE_PATH );
		console.log( `[preinstalled-sqlite] Generated ${ TEMPLATE_PATH }` );

		await validateGeneratedTemplate();
		console.log( '[preinstalled-sqlite] Generated template validation passed' );
	} catch ( error ) {
		if ( hadPreviousTemplate && fs.existsSync( TEMPLATE_BACKUP_PATH ) ) {
			fs.copyFileSync( TEMPLATE_BACKUP_PATH, TEMPLATE_PATH );
		} else {
			fs.rmSync( TEMPLATE_PATH, { force: true } );
		}
		throw error;
	} finally {
		stopSite( VALIDATION_SITE_PATH );
		stopSite( GENERATED_SITE_PATH );
		fs.rmSync( SESSION_PATH, { recursive: true, force: true } );
	}
}

void main();
