import fs from 'fs-extra';
import { createNodeFsMountHandler, loadNodeRuntime } from '@php-wasm/node';
import {
	MountHandler,
	PHP,
	PHPRequestHandler,
	proxyFileSystem,
	rotatePHPRuntime,
	setPhpIniEntries,
} from '@php-wasm/universal';
import {
	wordPressRewriteRules,
	getFileNotFoundActionForWordPress,
	setupPlatformLevelMuPlugins,
} from '@wp-playground/wordpress';
import path from 'path';
import { SQLITE_FILENAME } from './constants';
import { rootCertificates } from 'tls';
import { downloadMuPlugins, downloadSqliteIntegrationPlugin, downloadWordPress } from './download';
import {
	StepDefinition,
	activatePlugin,
	activateTheme,
	compileBlueprint,
	defineWpConfigConsts,
	runBlueprintSteps,
} from '@wp-playground/blueprints';
import getWpNowConfig, { WPNowOptions, WPNowMode } from './config';
import {
	hasIndexFile,
	isPluginDirectory,
	isThemeDirectory,
	isWpContentDirectory,
	isWordPressDirectory,
	isWordPressDevelopDirectory,
	getPluginFile,
	readFileHead,
} from './wp-playground-wordpress';
import { output } from './output';
import getWpNowPath from './get-wp-now-path';
import getWordpressVersionsPath from './get-wordpress-versions-path';
import getSqlitePath from './get-sqlite-path';
import { SymlinkManager } from '../../../src/lib/symlink-manager';

export default async function startWPNow(
	options: Partial< WPNowOptions > = {}
): Promise< { php: PHP; options: WPNowOptions } > {
	const { documentRoot } = options;
	const requestHandler = new PHPRequestHandler( {
		phpFactory: async ( { isPrimary, requestHandler: reqHandler } ) => {
			const { php } = await getPHPInstance( options, isPrimary, reqHandler );
			if ( ! isPrimary ) {
				proxyFileSystem( await requestHandler.getPrimaryPhp(), php, [
					'/tmp',
					requestHandler.documentRoot,
					'/internal/shared',
				] );
			}
			if ( reqHandler ) {
				php.requestHandler = reqHandler;
			}

			return php;
		},
		documentRoot: documentRoot || '/wordpress',
		absoluteUrl: options.absoluteUrl,
		rewriteRules: wordPressRewriteRules,
		getFileNotFoundAction: getFileNotFoundActionForWordPress,
	} );

	const php = await requestHandler.getPrimaryPhp();

	prepareDocumentRoot( php, options );

	output?.log( `directory: ${ options.projectPath }` );
	output?.log( `mode: ${ options.mode }` );
	output?.log( `php: ${ options.phpVersion }` );

	if ( options.mode === WPNowMode.INDEX ) {
		await runIndexMode( php, options );
		return { php, options };
	}
	output?.log( `wp: ${ options.wordPressVersion }` );
	await Promise.all( [
		downloadWordPress( options.wordPressVersion ),
		downloadSqliteIntegrationPlugin(),
		downloadMuPlugins(),
	] );

	if ( options.reset ) {
		fs.removeSync( options.wpContentPath );
		output?.log( 'Created a fresh SQLite database and wp-content directory.' );
	}

	const isFirstTimeProject = ! fs.existsSync( options.wpContentPath );

	await prepareWordPress( php, options );

	if ( options.blueprintObject ) {
		output?.log( `blueprint steps: ${ options.blueprintObject.steps.length }` );
		const compiled = compileBlueprint( options.blueprintObject, {
			onStepCompleted: ( result, step: StepDefinition ) => {
				output?.log( `Blueprint step completed: ${ step.step }` );
			},
		} );
		await runBlueprintSteps( compiled, php );
	}

	await installationSteps( php, options );
	await login( php, options );

	if ( isFirstTimeProject && [ WPNowMode.PLUGIN, WPNowMode.THEME ].includes( options.mode ) ) {
		await activatePluginOrTheme( php, options );
	}

	// Setup internal plugins needed for Playground
	await setupPlatformLevelMuPlugins( php );

	rotatePHPRuntime( {
		php,
		cwd: requestHandler.documentRoot,
		recreateRuntime: async () => {
			output?.log( 'Recreating and rotating PHP runtime' );
			const { php, runtimeId } = await getPHPInstance( options, true, requestHandler );
			prepareDocumentRoot( php, options );
			await prepareWordPress( php, options );
			return runtimeId;
		},
		maxRequests: 400,
	} );

	return {
		php,
		options,
	};
}

async function getPHPInstance(
	options: WPNowOptions,
	isPrimary: boolean,
	requestHandler: PHPRequestHandler
): Promise< { php: PHP; runtimeId: number } > {
	const id = await loadNodeRuntime( options.phpVersion );
	const php = new PHP( id );
	php.requestHandler = requestHandler;

	await setPhpIniEntries( php, {
		memory_limit: '256M',
		disable_functions: '',
		allow_url_fopen: '1',
		'openssl.cafile': '/internal/shared/ca-bundle.crt',
	} );

	return { php, runtimeId: id };
}

function prepareDocumentRoot( php: PHP, options: WPNowOptions ) {
	php.mkdir( options.documentRoot );
	php.chdir( options.documentRoot );
	php.writeFile( `${ options.documentRoot }/index.php`, `<?php echo 'Hello wp-now!';` );
	php.writeFile( '/internal/shared/ca-bundle.crt', rootCertificates.join( '\n' ) );
}

async function prepareWordPress( php: PHP, options: WPNowOptions ) {
	switch ( options.mode ) {
		case WPNowMode.WP_CONTENT:
			await runWpContentMode( php, options );
			break;
		case WPNowMode.WORDPRESS_DEVELOP:
			await runWordPressDevelopMode( php, options );
			break;
		case WPNowMode.WORDPRESS:
			await runWordPressMode( php, options );
			break;
		case WPNowMode.PLUGIN:
			await runPluginOrThemeMode( php, options );
			break;
		case WPNowMode.THEME:
			await runPluginOrThemeMode( php, options );
			break;
		case WPNowMode.PLAYGROUND:
			await runWpPlaygroundMode( php, options );
			break;
	}

	// Symlink manager is not yet supported on windows
	// See: https://github.com/Automattic/studio/issues/548
	if ( process.platform !== 'win32' ) {
		await startSymlinkManager(php, options.projectPath);
	}
}

/**
 * Start the symlink manager
 *
 * The symlink manager ensures that we mount the targets of symlinks so that they
 * work inside the php runtime. It also watches for changes to ensure symlinks
 * are managed correctly.
 *
 * @param php
 * @param projectPath
 */
async function startSymlinkManager(php: PHP, projectPath: string) {
	const symlinkManager = new SymlinkManager(php, projectPath);
	await symlinkManager.scanAndCreateSymlinks();
	symlinkManager.startWatching()
		.catch((err) => {
			output?.error('Error while watching for file changes', err);
		})
		.finally(() => {
			output?.log('Stopped watching for file changes');
		});

	// Ensure that we stop watching for file changes when the runtime is exiting
	php.addEventListener('runtime.beforedestroy', () => {
		symlinkManager.stopWatching();
	});
}

async function runIndexMode( php: PHP, { documentRoot, projectPath }: WPNowOptions ) {
	await php.mount(
		projectPath,
		createNodeFsMountHandler( documentRoot ) as unknown as MountHandler
	);
}

async function runWpContentMode(
	php: PHP,
	{ documentRoot, wordPressVersion, wpContentPath, projectPath, absoluteUrl }: WPNowOptions
) {
	const wordPressPath = path.join( getWordpressVersionsPath(), wordPressVersion );
	await php.mount(
		wordPressPath,
		createNodeFsMountHandler( documentRoot ) as unknown as MountHandler
	);
	await initWordPress( php, wordPressVersion, documentRoot, absoluteUrl );
	fs.ensureDirSync( wpContentPath );

	await php.mount(
		projectPath,
		createNodeFsMountHandler( `${ documentRoot }/wp-content` ) as unknown as MountHandler
	);

	await mountSqlitePlugin( php, documentRoot );
	await mountSqliteDatabaseDirectory( php, documentRoot, wpContentPath );
	await mountMuPlugins( php, documentRoot );
}

async function runWordPressDevelopMode(
	php: PHP,
	{ documentRoot, projectPath, absoluteUrl }: WPNowOptions
) {
	await runWordPressMode( php, {
		documentRoot,
		projectPath: projectPath + '/build',
		absoluteUrl,
	} );
}

async function runWordPressMode(
	php: PHP,
	{ documentRoot, projectPath, absoluteUrl }: WPNowOptions
) {
	php.mkdir( documentRoot );
	await php.mount(
		documentRoot,
		createNodeFsMountHandler( projectPath ) as unknown as MountHandler
	);

	await initWordPress( php, 'user-provided', documentRoot, absoluteUrl );

	await downloadMuPlugins( path.join( projectPath, 'wp-content', 'mu-plugins' ) );
}

async function runPluginOrThemeMode(
	php: PHP,
	{ wordPressVersion, documentRoot, projectPath, wpContentPath, absoluteUrl, mode }: WPNowOptions
) {
	const wordPressPath = path.join( getWordpressVersionsPath(), wordPressVersion );
	await php.mount(
		wordPressPath,
		createNodeFsMountHandler( documentRoot ) as unknown as MountHandler
	);
	await initWordPress( php, wordPressVersion, documentRoot, absoluteUrl );

	fs.ensureDirSync( wpContentPath );
	fs.copySync(
		path.join( getWordpressVersionsPath(), wordPressVersion, 'wp-content' ),
		wpContentPath
	);
	await php.mount(
		wpContentPath,
		createNodeFsMountHandler( `${ documentRoot }/wp-content` ) as unknown as MountHandler
	);

	const pluginName = path.basename( projectPath );
	const directoryName = mode === WPNowMode.PLUGIN ? 'plugins' : 'themes';
	await php.mount(
		projectPath,
		createNodeFsMountHandler(
			`${ documentRoot }/wp-content/${ directoryName }/${ pluginName }`
		) as unknown as MountHandler
	);
	if ( mode === WPNowMode.THEME ) {
		const templateName = getThemeTemplate( projectPath );
		if ( templateName ) {
			// We assume that the theme template is in the parent directory
			const templatePath = path.join( projectPath, '..', templateName );
			if ( fs.existsSync( templatePath ) ) {
				await php.mount(
					templatePath,
					createNodeFsMountHandler(
						`${ documentRoot }/wp-content/${ directoryName }/${ templateName }`
					) as unknown as MountHandler
				);
			} else {
				output?.error( `Parent for child theme not found: ${ templateName }` );
			}
		}
	}
	await mountSqlitePlugin( php, documentRoot );
	await mountMuPlugins( php, documentRoot );
}

async function runWpPlaygroundMode(
	php: PHP,
	{ documentRoot, wordPressVersion, wpContentPath, absoluteUrl }: WPNowOptions
) {
	const wordPressPath = path.join( getWordpressVersionsPath(), wordPressVersion );
	await php.mount(
		wordPressPath,
		createNodeFsMountHandler( documentRoot ) as unknown as MountHandler
	);
	await initWordPress( php, wordPressVersion, documentRoot, absoluteUrl );

	fs.ensureDirSync( wpContentPath );
	fs.copySync(
		path.join( getWordpressVersionsPath(), wordPressVersion, 'wp-content' ),
		wpContentPath
	);
	await php.mount(
		wpContentPath,
		createNodeFsMountHandler( `${ documentRoot }/wp-content` ) as unknown as MountHandler
	);

	await mountSqlitePlugin( php, documentRoot );
	await mountMuPlugins( php, documentRoot );
}

async function login( php: PHP, options: WPNowOptions = {} ) {
	const { documentRoot } = options;

	await php.writeFile(
		`${ documentRoot }/playground-login.php`,
		`<?php
		require_once( dirname( __FILE__ ) . '/wp-load.php' );

		if ( is_user_logged_in() ) {
			return;
		}

		$user = get_user_by( 'login', 'admin' );

		if ( $user ) {
			wp_set_password( '${ options.adminPassword }', $user->ID );
		} else {
			$user_data = array(
				'user_login' => 'admin',
				'user_pass' => '${ options.adminPassword }',
				'user_email' => 'admin@localhost.com',
				'role' => 'administrator',
			);
			$user_id = wp_insert_user( $user_data );
			$user = get_user_by( 'id', $user_id );
		}

		wp_set_current_user( $user->ID, $user->user_login );
		wp_set_auth_cookie( $user->ID );
		do_action( 'wp_login', $user->user_login, $user );`
	);

	await php.requestHandler.request( {
		url: '/playground-login.php',
	} );

	await php.unlink( `${ documentRoot }/playground-login.php` );
}

/**
 * Initialize WordPress
 *
 * Initializes WordPress by copying sample config file to wp-config.php if it doesn't exist,
 * and sets up additional constants for PHP.
 *
 * It also returns information about whether the default database should be initialized.
 *
 * @param php
 * @param wordPressVersion
 * @param vfsDocumentRoot
 * @param siteUrl
 */
async function initWordPress(
	php: PHP,
	wordPressVersion: string,
	vfsDocumentRoot: string,
	siteUrl: string
) {
	let initializeDefaultDatabase = false;
	if ( ! php.fileExists( `${ vfsDocumentRoot }/wp-config.php` ) ) {
		php.writeFile(
			`${ vfsDocumentRoot }/wp-config.php`,
			php.readFileAsText( `${ vfsDocumentRoot }/wp-config-sample.php` )
		);
		initializeDefaultDatabase = true;
	}

	const wpConfigConsts = {
		WP_HOME: siteUrl,
		WP_SITEURL: siteUrl,
	};
	if ( wordPressVersion !== 'user-defined' ) {
		wpConfigConsts[ 'WP_AUTO_UPDATE_CORE' ] = wordPressVersion === 'latest';
	}
	await defineWpConfigConsts( php, {
		consts: wpConfigConsts,
		method: 'define-before-run',
	} );

	return { initializeDefaultDatabase };
}

async function activatePluginOrTheme( php: PHP, { projectPath, mode }: WPNowOptions ) {
	if ( mode === WPNowMode.PLUGIN ) {
		const pluginFile = getPluginFile( projectPath );
		await activatePlugin( php, { pluginPath: pluginFile } );
	} else if ( mode === WPNowMode.THEME ) {
		const themeFolderName = path.basename( projectPath );
		await activateTheme( php, { themeFolderName } );
	}
}

export function getThemeTemplate( projectPath: string ) {
	const themeTemplateRegex = /^(?:[ \t]*<\?php)?[ \t/*#@]*Template:(.*)$/im;
	const styleCSS = readFileHead( path.join( projectPath, 'style.css' ) );
	if ( themeTemplateRegex.test( styleCSS ) ) {
		const themeName = themeTemplateRegex.exec( styleCSS )[ 1 ].trim();
		return themeName;
	}
}

async function mountMuPlugins( php: PHP, vfsDocumentRoot: string ) {
	await php.mount(
		path.join( getWpNowPath(), 'mu-plugins' ),
		// VFS paths always use forward / slashes so
		// we can't use path.join() for them
		createNodeFsMountHandler(
			`${ vfsDocumentRoot }/wp-content/mu-plugins`
		) as unknown as MountHandler
	);
}

async function mountSqlitePlugin( php: PHP, vfsDocumentRoot: string ) {
	const sqlitePluginPath = `${ vfsDocumentRoot }/wp-content/plugins/${ SQLITE_FILENAME }`;
	if ( php.listFiles( sqlitePluginPath ).length === 0 ) {
		await php.mount(
			getSqlitePath(),
			createNodeFsMountHandler( sqlitePluginPath ) as unknown as MountHandler
		);
		await php.mount(
			path.join( getSqlitePath(), 'db.copy' ),
			createNodeFsMountHandler(
				`${ vfsDocumentRoot }/wp-content/db.php`
			) as unknown as MountHandler
		);
	}
}

/**
 * Create SQLite database directory in hidden utility directory and mount it to the document root
 *
 * @param php
 * @param vfsDocumentRoot
 * @param wpContentPath
 */
async function mountSqliteDatabaseDirectory(
	php: PHP,
	vfsDocumentRoot: string,
	wpContentPath: string
) {
	fs.ensureDirSync( path.join( wpContentPath, 'database' ) );
	await php.mount(
		path.join( wpContentPath, 'database' ),
		createNodeFsMountHandler(
			`${ vfsDocumentRoot }/wp-content/database`
		) as unknown as MountHandler
	);
}

export function inferMode( projectPath: string ): Exclude< WPNowMode, WPNowMode.AUTO > {
	if ( isWordPressDevelopDirectory( projectPath ) ) {
		return WPNowMode.WORDPRESS_DEVELOP;
	} else if ( isWordPressDirectory( projectPath ) ) {
		return WPNowMode.WORDPRESS;
	} else if ( isWpContentDirectory( projectPath ) ) {
		return WPNowMode.WP_CONTENT;
	} else if ( isPluginDirectory( projectPath ) ) {
		return WPNowMode.PLUGIN;
	} else if ( isThemeDirectory( projectPath ) ) {
		return WPNowMode.THEME;
	} else if ( hasIndexFile( projectPath ) ) {
		return WPNowMode.INDEX;
	}
	return WPNowMode.PLAYGROUND;
}

async function installationSteps( php: PHP, options: WPNowOptions ) {
	const siteLanguage = options.siteLanguage;

	const executeStep = async ( step: 0 | 1 | 2 ) => {
		return php.requestHandler.request( {
			url: `/wp-admin/install.php?step=${ step }`,
			method: 'POST',
			body:
				step === 2
					? {
							language: siteLanguage,
							prefix: 'wp_',
							weblog_title: options.siteTitle,
							user_name: 'admin',
							admin_password: options.adminPassword,
							admin_password2: options.adminPassword,
							Submit: 'Install WordPress',
							pw_weak: '1',
							admin_email: 'admin@localhost.com',
					  }
					: {
							language: siteLanguage,
					  },
		} );
	};
	// First two steps are needed to download and set translations
	await executeStep( 0 );
	await executeStep( 1 );

	// Set up site details
	await executeStep( 2 );
}

export async function moveDatabasesInSitu( projectPath: string ) {
	const dbPhpPath = path.join( projectPath, 'wp-content', 'db.php' );
	const hasDbPhpInSitu = fs.existsSync( dbPhpPath ) && fs.lstatSync( dbPhpPath ).isFile();

	const { wpContentPath } = await getWpNowConfig( { path: projectPath } );
	if (
		wpContentPath &&
		fs.existsSync( path.join( wpContentPath, 'database' ) ) &&
		! hasDbPhpInSitu
	) {
		// Do not mount but move the files to projectPath once
		const databasePath = path.join( projectPath, 'wp-content', 'database' );
		fs.rmdirSync( databasePath );
		fs.moveSync( path.join( wpContentPath, 'database' ), databasePath );

		const sqlitePath = path.join( projectPath, 'wp-content', 'plugins', SQLITE_FILENAME );
		fs.rmdirSync( sqlitePath );
		fs.copySync( path.join( getSqlitePath() ), sqlitePath );

		fs.rmdirSync( dbPhpPath );
		fs.copySync( path.join( getSqlitePath(), 'db.copy' ), dbPhpPath );
		fs.rmSync( wpContentPath, { recursive: true, force: true } );
	}
}
