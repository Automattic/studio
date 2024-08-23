import fs from 'fs-extra';
import { loadNodeRuntime,createNodeFsMountHandler } from '@php-wasm/node';
import { MountHandler, PHP, PHPRequestHandler, setPhpIniEntries } from '@php-wasm/universal';
import path from 'path';
import { SQLITE_FILENAME } from './constants';
import {
	downloadMuPlugins,
	downloadSqliteIntegrationPlugin,
	downloadWordPress,
} from './download';
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

async function applyToInstances(phpInstances: PHP[], callback: Function) {
	for (let i = 0; i < phpInstances.length; i++) {
		await callback(phpInstances[i]);
	}
}

export default async function startWPNow(
	options: Partial<WPNowOptions> = {}
): Promise<{ php: PHP; phpInstances: PHP[]; options: WPNowOptions }> {
	const { documentRoot } = options;


	const requestHandler = new PHPRequestHandler({
		phpFactory: async ({ isPrimary }) => {
			const id = await loadNodeRuntime( options.phpVersion );
			const php = new PHP(id)
			await setPhpIniEntries(php, {
				'memory_limit': '256M'
			});
			return php;
		},
		documentRoot: documentRoot || '/wordpress',
		absoluteUrl: options.absoluteUrl,
		rewriteRules: []
	});

	const php = await requestHandler.getPrimaryPhp()


	php.mkdir(documentRoot);
	php.chdir(documentRoot);
	php.writeFile(
		`${documentRoot}/index.php`,
		`<?php echo 'Hello wp-now!';`
	);

	output?.log(`directory: ${options.projectPath}`);
	output?.log(`mode: ${options.mode}`);
	output?.log(`php: ${options.phpVersion}`);

	if (options.mode === WPNowMode.INDEX) {
		await applyToInstances([php], async (_php) => {
			runIndexMode(_php, options);
		});
		return { php, phpInstances:[php], options };
	}
	output?.log(`wp: ${options.wordPressVersion}`);
	await Promise.all([
		downloadWordPress(options.wordPressVersion),
		downloadSqliteIntegrationPlugin(),
		downloadMuPlugins(),
	]);

	if (options.reset) {
		fs.removeSync(options.wpContentPath);
		output?.log(
			'Created a fresh SQLite database and wp-content directory.'
		);
	}

	const isFirstTimeProject = !fs.existsSync(options.wpContentPath);
	await applyToInstances([php], async (_php) => {
		switch (options.mode) {
			case WPNowMode.WP_CONTENT:
				await runWpContentMode(_php, options);
				break;
			case WPNowMode.WORDPRESS_DEVELOP:
				await runWordPressDevelopMode(_php, options);
				break;
			case WPNowMode.WORDPRESS:
				await runWordPressMode(_php, options);
				break;
			case WPNowMode.PLUGIN:
				await runPluginOrThemeMode(_php, options);
				break;
			case WPNowMode.THEME:
				await runPluginOrThemeMode(_php, options);
				break;
			case WPNowMode.PLAYGROUND:
				await runWpPlaygroundMode(_php, options);
				break;
		}
	});

	if (options.blueprintObject) {
		output?.log(`blueprint steps: ${options.blueprintObject.steps.length}`);
		const compiled = compileBlueprint(options.blueprintObject, {
			onStepCompleted: (result, step: StepDefinition) => {
				output?.log(`Blueprint step completed: ${step.step}`);
			},
		});
		await runBlueprintSteps(compiled, php);
	}

	await installationSteps(php, options);
	await login(php, options);

	if (
		isFirstTimeProject &&
		[WPNowMode.PLUGIN, WPNowMode.THEME].includes(options.mode)
	) {
		await activatePluginOrTheme(php, options);
	}

	return {
		php,
		phpInstances: [php],
		options,
	};
}

async function runIndexMode(
	php: PHP,
	{ documentRoot, projectPath }: WPNowOptions
) {
	php.mount(projectPath, createNodeFsMountHandler( documentRoot ) );
}

async function runWpContentMode(
	php: PHP,
	{
		documentRoot,
		wordPressVersion,
		wpContentPath,
		projectPath,
		absoluteUrl,
	}: WPNowOptions
) {
	const wordPressPath = path.join(
		getWordpressVersionsPath(),
		wordPressVersion
	);
	php.mount(wordPressPath, createNodeFsMountHandler( documentRoot ) );
	await initWordPress(php, wordPressVersion, documentRoot, absoluteUrl);
	fs.ensureDirSync(wpContentPath);

	php.mount(projectPath, createNodeFsMountHandler(  `${documentRoot}/wp-content` ));

	mountSqlitePlugin(php, documentRoot);
	mountSqliteDatabaseDirectory(php, documentRoot, wpContentPath);
	mountMuPlugins(php, documentRoot);
}

async function runWordPressDevelopMode(
	php: PHP,
	{ documentRoot, projectPath, absoluteUrl }: WPNowOptions
) {
	await runWordPressMode(php, {
		documentRoot,
		projectPath: projectPath + '/build',
		absoluteUrl,
	});
}

async function runWordPressMode(
	php: PHP,
	{ documentRoot, projectPath, absoluteUrl }: WPNowOptions
) {
	php.mount(projectPath, createNodeFsMountHandler( documentRoot ));

	await initWordPress(
		php,
		'user-provided',
		documentRoot,
		absoluteUrl
	);

	downloadMuPlugins(path.join(projectPath, 'wp-content', 'mu-plugins'));
}

async function runPluginOrThemeMode(
	php: PHP,
	{
		wordPressVersion,
		documentRoot,
		projectPath,
		wpContentPath,
		absoluteUrl,
		mode,
	}: WPNowOptions
) {
	const wordPressPath = path.join(
		getWordpressVersionsPath(),
		wordPressVersion
	);
	php.mount(wordPressPath, createNodeFsMountHandler( documentRoot ));
	await initWordPress(php, wordPressVersion, documentRoot, absoluteUrl);

	fs.ensureDirSync(wpContentPath);
	fs.copySync(
		path.join(getWordpressVersionsPath(), wordPressVersion, 'wp-content'),
		wpContentPath
	);
	php.mount(wpContentPath, createNodeFsMountHandler( `${documentRoot}/wp-content`));

	const pluginName = path.basename(projectPath);
	const directoryName = mode === WPNowMode.PLUGIN ? 'plugins' : 'themes';
	php.mount(
		projectPath,
		createNodeFsMountHandler( `${documentRoot}/wp-content/${directoryName}/${pluginName}`)
	);
	if (mode === WPNowMode.THEME) {
		const templateName = getThemeTemplate(projectPath);
		if (templateName) {
			// We assume that the theme template is in the parent directory
			const templatePath = path.join(projectPath, '..', templateName);
			if (fs.existsSync(templatePath)) {
				php.mount(
					templatePath,
					createNodeFsMountHandler( `${documentRoot}/wp-content/${directoryName}/${templateName}`)
				);
			} else {
				output?.error(
					`Parent for child theme not found: ${templateName}`
				);
			}
		}
	}
	mountSqlitePlugin(php, documentRoot);
	mountMuPlugins(php, documentRoot);
}

async function runWpPlaygroundMode(
	php: PHP,
	{ documentRoot, wordPressVersion, wpContentPath, absoluteUrl }: WPNowOptions
) {
	const wordPressPath = path.join(
		getWordpressVersionsPath(),
		wordPressVersion
	);
	php.mount(wordPressPath, createNodeFsMountHandler( documentRoot));
	await initWordPress(php, wordPressVersion, documentRoot, absoluteUrl);

	fs.ensureDirSync(wpContentPath);
	fs.copySync(
		path.join(getWordpressVersionsPath(), wordPressVersion, 'wp-content'),
		wpContentPath
	);
	php.mount(wpContentPath, createNodeFsMountHandler( `${documentRoot}/wp-content`));

	mountSqlitePlugin(php, documentRoot);
	mountMuPlugins(php, documentRoot);
}

async function login(php: PHP, options: WPNowOptions = {}) {
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

	await php.request( {
		url: '/playground-login.php',
	} );

	await php.unlink( `${documentRoot}/playground-login.php` );
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
	if (!php.fileExists(`${vfsDocumentRoot}/wp-config.php`)) {
		php.writeFile(
			`${vfsDocumentRoot}/wp-config.php`,
			php.readFileAsText(`${vfsDocumentRoot}/wp-config-sample.php`)
		);
		initializeDefaultDatabase = true;
	}

	const wpConfigConsts = {
		WP_HOME: siteUrl,
		WP_SITEURL: siteUrl,
	};
	if (wordPressVersion !== 'user-defined') {
		wpConfigConsts['WP_AUTO_UPDATE_CORE'] = wordPressVersion === 'latest';
	}
	await defineWpConfigConsts(php, {
		consts: wpConfigConsts,
		method: 'define-before-run',
	});

	return { initializeDefaultDatabase };
}

async function activatePluginOrTheme(
	php: PHP,
	{ projectPath, mode }: WPNowOptions
) {
	if (mode === WPNowMode.PLUGIN) {
		const pluginFile = getPluginFile(projectPath);
		await activatePlugin(php, { pluginPath: pluginFile });
	} else if (mode === WPNowMode.THEME) {
		const themeFolderName = path.basename(projectPath);
		await activateTheme(php, { themeFolderName });
	}
}

export function getThemeTemplate(projectPath: string) {
	const themeTemplateRegex = /^(?:[ \t]*<\?php)?[ \t/*#@]*Template:(.*)$/im;
	const styleCSS = readFileHead(path.join(projectPath, 'style.css'));
	if (themeTemplateRegex.test(styleCSS)) {
		const themeName = themeTemplateRegex.exec(styleCSS)[1].trim();
		return themeName;
	}
}

function mountMuPlugins(php: PHP, vfsDocumentRoot: string) {
	php.mount(
		path.join(getWpNowPath(), 'mu-plugins'),
		// VFS paths always use forward / slashes so
		// we can't use path.join() for them
		createNodeFsMountHandler( `${vfsDocumentRoot}/wp-content/mu-plugins`)
	);
}

function mountSqlitePlugin(php: PHP, vfsDocumentRoot: string) {
	const sqlitePluginPath = `${vfsDocumentRoot}/wp-content/plugins/${SQLITE_FILENAME}`;
	if (php.listFiles(sqlitePluginPath).length === 0) {
		php.mount(getSqlitePath(), sqlitePluginPath);
		php.mount(
			path.join(getSqlitePath(), 'db.copy'),
			createNodeFsMountHandler( `${vfsDocumentRoot}/wp-content/db.php`)
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
function mountSqliteDatabaseDirectory(
	php: PHP,
	vfsDocumentRoot: string,
	wpContentPath: string
) {
	fs.ensureDirSync(path.join(wpContentPath, 'database'));
	php.mount(
		path.join(wpContentPath, 'database'),
		createNodeFsMountHandler( `${vfsDocumentRoot}/wp-content/database` )
	);
}

export function inferMode(
	projectPath: string
): Exclude<WPNowMode, WPNowMode.AUTO> {
	if (isWordPressDevelopDirectory(projectPath)) {
		return WPNowMode.WORDPRESS_DEVELOP;
	} else if (isWordPressDirectory(projectPath)) {
		return WPNowMode.WORDPRESS;
	} else if (isWpContentDirectory(projectPath)) {
		return WPNowMode.WP_CONTENT;
	} else if (isPluginDirectory(projectPath)) {
		return WPNowMode.PLUGIN;
	} else if (isThemeDirectory(projectPath)) {
		return WPNowMode.THEME;
	} else if (hasIndexFile(projectPath)) {
		return WPNowMode.INDEX;
	}
	return WPNowMode.PLAYGROUND;
}

async function installationSteps(php: PHP, options: WPNowOptions) {
	const siteLanguage = options.siteLanguage;

	const executeStep = async ( step: 0 | 1 | 2 ) => {
		return php.request( {
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