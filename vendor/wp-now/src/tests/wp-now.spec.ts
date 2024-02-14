import startWPNow, { getThemeTemplate, inferMode } from '../wp-now';
import { startServer } from '../';
import getWpNowConfig, { CliOptions, WPNowMode } from '../config';
import fs from 'fs-extra';
import path from 'path';
import {
	isPluginDirectory,
	isThemeDirectory,
	isWpContentDirectory,
	isWordPressDirectory,
	isWordPressDevelopDirectory,
} from '../wp-playground-wordpress';
import {
	downloadSqliteIntegrationPlugin,
	downloadWPCLI,
	downloadWordPress,
} from '../download';
import os from 'os';
import crypto from 'crypto';
import getWpNowTmpPath from '../get-wp-now-tmp-path';
import getWpCliTmpPath from '../get-wp-cli-tmp-path';
import { executeWPCli } from '../execute-wp-cli';
import { runCli } from '../run-cli';

const exampleDir = __dirname + '/mode-examples';

async function downloadWithTimer(name, fn) {
	console.log(`Downloading ${name}...`);
	console.time(name);
	await fn();
	console.log(`${name} downloaded.`);
	console.timeEnd(name);
}

// Options
test('getWpNowConfig with default options', async () => {
	const projectDirectory = exampleDir + '/index';
	const rawOptions: CliOptions = {
		path: projectDirectory,
	};
	const options = await getWpNowConfig(rawOptions);

	expect(options.phpVersion).toBe('8.0');
	expect(options.wordPressVersion).toBe('latest');
	expect(options.documentRoot).toBe('/var/www/html');
	expect(options.mode).toBe(WPNowMode.INDEX);
	expect(options.projectPath).toBe(projectDirectory);
});

//TODO: Add it back when all options are supported as cli arguments
// test('parseOptions with custom options', async () => {
// 	const rawOptions: Partial<WPNowOptions> = {
// 		phpVersion: '7.3',
// 		wordPressVersion: '5.7',
// 		documentRoot: '/var/www/my-site',
// 		mode: WPNowMode.WORDPRESS,
// 		projectPath: '/path/to/my-site',
// 		wpContentPath: '/path/to/my-site/wp-content',
// 		absoluteUrl: 'http://localhost:8080',
// 	};
// 	const options = await parseOptions(rawOptions);
// 	expect(options.phpVersion).toBe('7.3');
// 	expect(options.wordPressVersion).toBe('5.7');
// 	expect(options.documentRoot).toBe('/var/www/my-site');
// 	expect(options.mode).toBe(WPNowMode.WORDPRESS);
// 	expect(options.projectPath).toBe('/path/to/my-site');
// 	expect(options.wpContentPath).toBe('/path/to/my-site/wp-content');
// 	expect(options.absoluteUrl).toBe('http://localhost:8080');
// });

test('getWpNowConfig with unsupported PHP version', async () => {
	const rawOptions: CliOptions = {
		php: '5.4' as any,
	};
	await expect(getWpNowConfig(rawOptions)).rejects.toThrowError(
		'Unsupported PHP version: 5.4.'
	);
});

// Plugin mode
test('isPluginDirectory detects a WordPress plugin and infer PLUGIN mode.', () => {
	const projectPath = exampleDir + '/plugin';
	expect(isPluginDirectory(projectPath)).toBe(true);
	expect(inferMode(projectPath)).toBe(WPNowMode.PLUGIN);
});

test('isPluginDirectory detects a WordPress plugin in case-insensitive way and infer PLUGIN mode.', () => {
	const projectPath = exampleDir + '/plugin-case-insensitive';
	expect(isPluginDirectory(projectPath)).toBe(true);
	expect(inferMode(projectPath)).toBe(WPNowMode.PLUGIN);
});

test('isPluginDirectory returns false for non-plugin directory', () => {
	const projectPath = exampleDir + '/not-plugin';
	expect(isPluginDirectory(projectPath)).toBe(false);
	expect(inferMode(projectPath)).toBe(WPNowMode.PLAYGROUND);
});

// Theme mode
test('isThemeDirectory detects a WordPress theme and infer THEME mode', () => {
	const projectPath = exampleDir + '/theme';
	expect(isThemeDirectory(projectPath)).toBe(true);
	expect(inferMode(projectPath)).toBe(WPNowMode.THEME);
});

test('getThemeTemplate detects if a WordPress theme has a parent template.', () => {
	const projectPath = exampleDir + '/child-theme/child';
	expect(getThemeTemplate(projectPath)).toBe('parent');
	expect(inferMode(projectPath)).toBe(WPNowMode.THEME);
});

test('getThemeTemplate returns falsy value for themes without parent', () => {
	const projectPath = exampleDir + '/theme';
	expect(getThemeTemplate(projectPath)).toBe(undefined);
	expect(inferMode(projectPath)).toBe(WPNowMode.THEME);
});

test('isThemeDirectory returns false for non-theme directory', () => {
	const projectPath = exampleDir + '/not-theme';
	expect(isThemeDirectory(projectPath)).toBe(false);
	expect(inferMode(projectPath)).toBe(WPNowMode.PLAYGROUND);
});

test('isThemeDirectory returns false for a directory with style.css but without Theme Name', () => {
	const projectPath = exampleDir + '/not-theme';

	expect(isThemeDirectory(projectPath)).toBe(false);
	expect(inferMode(projectPath)).toBe(WPNowMode.PLAYGROUND);
});

// WP_CONTENT mode
test('isWpContentDirectory detects a WordPress wp-content directory and infer WP_CONTENT mode', () => {
	const projectPath = exampleDir + '/wp-content';
	expect(isWpContentDirectory(projectPath)).toBe(true);
	expect(isWordPressDirectory(projectPath)).toBe(false);
	expect(inferMode(projectPath)).toBe(WPNowMode.WP_CONTENT);
});

test('isWpContentDirectory returns false for wp-content parent directory', () => {
	const projectPath = exampleDir + '/index';
	expect(isWpContentDirectory(projectPath)).toBe(false);
	expect(isWordPressDirectory(projectPath)).toBe(false);
	expect(inferMode(projectPath)).toBe(WPNowMode.INDEX);
});

test('isWpContentDirectory returns true for a directory with only themes directory', () => {
	const projectPath = exampleDir + '/wp-content-only-themes';
	expect(isWpContentDirectory(projectPath)).toBe(true);
	expect(isWordPressDirectory(projectPath)).toBe(false);
	expect(inferMode(projectPath)).toBe(WPNowMode.WP_CONTENT);
});

test('isWpContentDirectory returns true for a directory with only mu-plugins directory', () => {
	const projectPath = exampleDir + '/wp-content-only-mu-plugins';
	expect(isWpContentDirectory(projectPath)).toBe(true);
	expect(isWordPressDirectory(projectPath)).toBe(false);
	expect(inferMode(projectPath)).toBe(WPNowMode.WP_CONTENT);
});

// WordPress mode
test('isWordPressDirectory detects a WordPress directory and WORDPRESS mode', () => {
	const projectPath = exampleDir + '/wordpress';

	expect(isWordPressDirectory(projectPath)).toBe(true);
	expect(inferMode(projectPath)).toBe(WPNowMode.WORDPRESS);
});

test('isWordPressDirectory returns false for non-WordPress directory', () => {
	const projectPath = exampleDir + '/nothing';

	expect(isWordPressDirectory(projectPath)).toBe(false);
	expect(inferMode(projectPath)).toBe(WPNowMode.PLAYGROUND);
});

// WordPress developer mode
test('isWordPressDevelopDirectory detects a WordPress-develop directory and WORDPRESS_DEVELOP mode', () => {
	const projectPath = exampleDir + '/wordpress-develop';

	expect(isWordPressDevelopDirectory(projectPath)).toBe(true);
	expect(inferMode(projectPath)).toBe(WPNowMode.WORDPRESS_DEVELOP);
});

test('isWordPressDevelopDirectory returns false for non-WordPress-develop directory', () => {
	const projectPath = exampleDir + '/nothing';

	expect(isWordPressDevelopDirectory(projectPath)).toBe(false);
	expect(inferMode(projectPath)).toBe(WPNowMode.PLAYGROUND);
});

test('isWordPressDevelopDirectory returns false for incomplete WordPress-develop directory', () => {
	const projectPath = exampleDir + '/not-wordpress-develop';

	expect(isWordPressDevelopDirectory(projectPath)).toBe(false);
	expect(inferMode(projectPath)).toBe(WPNowMode.PLAYGROUND);
});

describe('Test starting different modes', () => {
	let tmpExampleDirectory;

	/**
	 * Download an initial copy of WordPress
	 */
	beforeAll(async () => {
		fs.rmSync(getWpNowTmpPath(), { recursive: true, force: true });
		await Promise.all([
			downloadWithTimer('wordpress', downloadWordPress),
			downloadWithTimer('sqlite', downloadSqliteIntegrationPlugin),
		]);
	});

	/**
	 * Copy example directory to a temporary directory
	 */
	beforeEach(() => {
		const tmpDirectory = os.tmpdir();
		const directoryHash = crypto.randomBytes(20).toString('hex');

		tmpExampleDirectory = path.join(
			tmpDirectory,
			`wp-now-tests-examples-${directoryHash}`
		);
		fs.ensureDirSync(tmpExampleDirectory);
		fs.copySync(exampleDir, tmpExampleDirectory);
	});

	/**
	 * Remove temporary directory
	 */
	afterEach(() => {
		fs.rmSync(tmpExampleDirectory, { recursive: true, force: true });
	});

	/**
	 * Remove wp-now hidden directory from temporary directory.
	 */
	afterAll(() => {
		fs.rmSync(getWpNowTmpPath(), { recursive: true, force: true });
	});

	/**
	 * Expect that all provided mount point paths are empty directories which are result of file system mounts.
	 *
	 * @param mountPaths List of mount point paths that should exist on file system.
	 * @param projectPath Project path.
	 */
	const expectEmptyMountPoints = (mountPaths, projectPath) => {
		mountPaths.map((relativePath) => {
			const fullPath = path.join(projectPath, relativePath);

			expect({
				path: fullPath,
				exists: fs.existsSync(fullPath),
			}).toStrictEqual({ path: fullPath, exists: true });

			expect({
				path: fullPath,
				content: fs.readdirSync(fullPath),
			}).toStrictEqual({ path: fullPath, content: [] });

			expect({
				path: fullPath,
				isDirectory: fs.lstatSync(fullPath).isDirectory(),
			}).toStrictEqual({ path: fullPath, isDirectory: true });
		});
	};

	/**
	 * Expect that all listed files do not exist in project directory
	 *
	 * @param forbiddenFiles List of files that should not exist on file system.
	 * @param projectPath Project path.
	 */
	const expectForbiddenProjectFiles = (forbiddenFiles, projectPath) => {
		forbiddenFiles.map((relativePath) => {
			const fullPath = path.join(projectPath, relativePath);
			expect({
				path: fullPath,
				exists: fs.existsSync(fullPath),
			}).toStrictEqual({ path: fullPath, exists: false });
		});
	};

	/**
	 * Expect that all required files exist for PHP.
	 *
	 * @param requiredFiles List of files that should be accessible by PHP.
	 * @param documentRoot Document root of the PHP server.
	 * @param php NodePHP instance.
	 */
	const expectRequiredRootFiles = (requiredFiles, documentRoot, php) => {
		requiredFiles.map((relativePath) => {
			const fullPath = path.join(documentRoot, relativePath);
			expect({
				path: fullPath,
				exists: php.fileExists(fullPath),
			}).toStrictEqual({ path: fullPath, exists: true });
		});
	};

	/**
	 * Test that startWPNow in "index", "plugin", "theme", and "playground" modes doesn't change anything in the project directory.
	 */
	test.each([
		['index', ['index.php']],
		['plugin', ['sample-plugin.php']],
		['theme', ['style.css']],
		['playground', ['my-file.txt']],
	])('startWPNow starts %s mode', async (mode, expectedDirectories) => {
		const projectPath = path.join(tmpExampleDirectory, mode);

		const rawOptions: CliOptions = {
			path: projectPath,
		};

		const options = await getWpNowConfig(rawOptions);

		await startWPNow(options);

		const forbiddenPaths = ['wp-config.php'];

		expectForbiddenProjectFiles(forbiddenPaths, projectPath);

		expect(fs.readdirSync(projectPath)).toEqual(expectedDirectories);
	});

	/**
	 * Test that startWPNow in "wp-content" mode mounts required files and directories, and
	 * that required files exist for PHP.
	 */
	test('startWPNow starts wp-content mode', async () => {
		const projectPath = path.join(tmpExampleDirectory, 'wp-content');

		const rawOptions: CliOptions = {
			path: projectPath,
		};

		const options = await getWpNowConfig(rawOptions);

		const { php, options: wpNowOptions } = await startWPNow(options);

		const mountPointPaths = [
			'database',
			'db.php',
			'mu-plugins',
			'plugins/sqlite-database-integration',
		];

		expectEmptyMountPoints(mountPointPaths, projectPath);

		const forbiddenPaths = ['wp-config.php'];

		expectForbiddenProjectFiles(forbiddenPaths, projectPath);

		const requiredFiles = [
			'wp-content/db.php',
			'wp-content/mu-plugins/0-allow-wp-org.php',
		];

		expectRequiredRootFiles(requiredFiles, wpNowOptions.documentRoot, php);
	});

	/**
	 * Test that startWPNow in "wordpress" mode without existing wp-config.php file mounts
	 * required files and directories, and that required files exist for PHP.
	 */
	test('startWPNow starts wordpress mode', async () => {
		const projectPath = path.join(tmpExampleDirectory, 'wordpress');

		const rawOptions: CliOptions = {
			path: projectPath,
		};
		const options = await getWpNowConfig(rawOptions);

		const { php, options: wpNowOptions } = await startWPNow(options);

		const mountPointPaths = [
			'wp-content/database',
			'wp-content/db.php',
			'wp-content/mu-plugins',
			'wp-content/plugins/sqlite-database-integration',
		];

		expectEmptyMountPoints(mountPointPaths, projectPath);

		const requiredFiles = [
			'wp-content/db.php',
			'wp-content/mu-plugins/0-allow-wp-org.php',
			'wp-config.php',
		];

		expectRequiredRootFiles(requiredFiles, wpNowOptions.documentRoot, php);
	});

	/**
	 * Test that startWPNow in "wordpress" mode with existing wp-config.php file mounts
	 * required files and directories, and that required files exist for PHP.
	 */
	test('startWPNow starts wordpress mode with existing wp-config', async () => {
		const projectPath = path.join(
			tmpExampleDirectory,
			'wordpress-with-config'
		);

		const rawOptions: CliOptions = {
			path: projectPath,
		};
		const options = await getWpNowConfig(rawOptions);

		const { php, options: wpNowOptions } = await startWPNow(options);

		const mountPointPaths = ['wp-content/mu-plugins'];

		expectEmptyMountPoints(mountPointPaths, projectPath);

		const forbiddenPaths = [
			'wp-content/database',
			'wp-content/db.php',
			'wp-content/plugins/sqlite-database-integration',
		];

		expectForbiddenProjectFiles(forbiddenPaths, projectPath);

		const requiredFiles = [
			'wp-content/mu-plugins/0-allow-wp-org.php',
			'wp-config.php',
		];

		expectRequiredRootFiles(requiredFiles, wpNowOptions.documentRoot, php);
	});

	/**
	 * Test that startWPNow in "plugin" mode auto installs the plugin.
	 */
	test('startWPNow auto installs the plugin', async () => {
		const projectPath = path.join(tmpExampleDirectory, 'plugin');
		const options = await getWpNowConfig({ path: projectPath });
		const { php } = await startWPNow(options);
		const codeIsPluginActivePhp = `<?php
    require_once('${php.documentRoot}/wp-load.php');
    require_once('${php.documentRoot}/wp-admin/includes/plugin.php');

    if (is_plugin_active('plugin/sample-plugin.php')) {
      echo 'plugin/sample-plugin.php is active';
    }
    `;
		const isPluginActive = await php.run({
			code: codeIsPluginActivePhp,
		});

		expect(isPluginActive.text).toContain(
			'plugin/sample-plugin.php is active'
		);
	});

	/**
	 * Test that startWPNow in "plugin" mode does not auto install the plugin the second time.
	 */
	test('startWPNow auto installs the plugin', async () => {
		const projectPath = path.join(tmpExampleDirectory, 'plugin');
		const options = await getWpNowConfig({ path: projectPath });
		const { php } = await startWPNow(options);
		const deactivatePluginPhp = `<?php
    require_once('${php.documentRoot}/wp-load.php');
    require_once('${php.documentRoot}/wp-admin/includes/plugin.php');
    deactivate_plugins('plugin/sample-plugin.php');
    `;
		await php.run({ code: deactivatePluginPhp });
		// Run startWPNow a second time.
		const { php: phpSecondTime } = await startWPNow(options);
		const codeIsPluginActivePhp = `<?php
    require_once('${php.documentRoot}/wp-load.php');
    require_once('${php.documentRoot}/wp-admin/includes/plugin.php');

    if (is_plugin_active('plugin/sample-plugin.php')) {
      echo 'plugin/sample-plugin.php is active';
    } else {
      echo 'plugin not active';
    }
    `;
		const isPluginActive = await phpSecondTime.run({
			code: codeIsPluginActivePhp,
		});

		expect(isPluginActive.text).toContain('plugin not active');
	});

	/**
	 * Test that startWPNow in "theme" mode auto activates the theme.
	 */
	test('startWPNow auto installs the theme', async () => {
		const projectPath = path.join(tmpExampleDirectory, 'theme');
		const options = await getWpNowConfig({ path: projectPath });
		const { php } = await startWPNow(options);
		const codeActiveThemeNamePhp = `<?php
    require_once('${php.documentRoot}/wp-load.php');
    echo wp_get_theme()->get('Name');
    `;
		const themeName = await php.run({
			code: codeActiveThemeNamePhp,
		});

		expect(themeName.text).toContain('Yolo Theme');
	});

	/**
	 * Test that startWPNow in "theme" mode auto activates the theme.
	 */
	test('startWPNow auto installs mounts child and parent theme.', async () => {
		const projectPath = path.join(tmpExampleDirectory, 'child-theme/child');
		const options = await getWpNowConfig({ path: projectPath });
		const { php } = await startWPNow(options);

		const childThemePhp = `<?php
		require_once('${php.documentRoot}/wp-load.php');
		echo wp_get_theme()->get('Name');
		`;

		const parentThemePhp = `<?php
		    require_once('${php.documentRoot}/wp-load.php');
			$theme = wp_get_theme( 'parent' );
			if ( $theme->exists() ) {
				echo $theme->get('Name');
			} else {
				echo 'Not found';
			}
		`;

		const childThemeName = await php.run({
			code: childThemePhp,
		});
		const parentThemeName = await php.run({
			code: parentThemePhp,
		});

		expect(childThemeName.text).toContain('Child Theme');
		expect(parentThemeName.text).toContain('Parent Theme');
	});

	/**
	 * Test that startWPNow in "theme" mode auto activates the theme.
	 */
	test('startWPNow auto handles child theme with missing parent.', async () => {
		const projectPath = path.join(
			tmpExampleDirectory,
			'child-theme-missing-parent/child'
		);
		const options = await getWpNowConfig({ path: projectPath });
		const { php } = await startWPNow(options);

		const childThemePhp = `<?php
		require_once('${php.documentRoot}/wp-load.php');
		echo wp_get_theme()->get('Name');
		`;

		const childThemeName = await php.run({
			code: childThemePhp,
		});

		expect(childThemeName.text).toContain('Child Theme');
	});

	/**
	 * Test that startWPNow in "theme" mode does not auto activate the theme the second time.
	 */
	test('startWPNow auto installs the theme', async () => {
		const projectPath = path.join(tmpExampleDirectory, 'theme');
		const options = await getWpNowConfig({ path: projectPath });
		const { php } = await startWPNow(options);
		const switchThemePhp = `<?php
    require_once('${php.documentRoot}/wp-load.php');
    switch_theme('twentytwentythree');
    `;
		await php.run({ code: switchThemePhp });
		// Run startWPNow a second time.
		const { php: phpSecondTime } = await startWPNow(options);
		const codeActiveThemeNamePhp = `<?php
    require_once('${php.documentRoot}/wp-load.php');
    echo wp_get_theme()->get('Name');
    `;
		const themeName = await phpSecondTime.run({
			code: codeActiveThemeNamePhp,
		});

		expect(themeName.text).toContain('Twenty Twenty-Three');
	});

	/*
	 * Test that startWPNow doesn't leave dirty files.
	 *
	 * @see https://github.com/WordPress/playground-tools/issues/32
	 */
	test.skip('startWPNow does not leave dirty folders and files', async () => {
		const projectPath = path.join(tmpExampleDirectory, 'wordpress');
		const options = await getWpNowConfig({ path: projectPath });
		await startWPNow(options);
		expect(
			fs.existsSync(
				path.join(
					projectPath,
					'wp-content',
					'mu-plugins',
					'0-allow-wp-org.php'
				)
			)
		).toBe(false);
		expect(
			fs.existsSync(path.join(projectPath, 'wp-content', 'database'))
		).toBe(false);
		expect(
			fs.existsSync(
				path.join(
					projectPath,
					'wp-content',
					'plugins',
					'sqlite-database-integration'
				)
			)
		).toBe(false);
		expect(
			fs.existsSync(path.join(projectPath, 'wp-content', 'db.php'))
		).toBe(false);
	});

	/**
	 * Test PHP integration test executing runCli.
	 */
	describe('validate php comand arguments passed through yargs', () => {
		const phpExampleDir = path.join(__dirname, 'execute-php');
		const argv = process.argv;
		let output = '';
		let processExitMock;
		beforeEach(() => {
			vi.spyOn(console, 'log').mockImplementation((newLine: string) => {
				output += `${newLine}\n`;
			});
			processExitMock = vi
				.spyOn(process, 'exit')
				.mockImplementation(() => null);
		});

		afterEach(() => {
			output = '';
			process.argv = argv;
			vi.resetAllMocks();
		});

		test('php should receive the correct yargs arguments', async () => {
			process.argv = ['node', 'wp-now', 'php', '--', '--version'];
			await runCli();
			expect(output).toMatch(/PHP 8\.0(.*)\(cli\)/i);
			expect(processExitMock).toHaveBeenCalledWith(0);
		});

		test('wp-now should change the php version', async () => {
			process.argv = [
				'node',
				'wp-now',
				'php',
				'--php=7.4',
				'--',
				'--version',
			];
			await runCli();
			expect(output).toMatch(/PHP 7\.4(.*)\(cli\)/i);
			expect(processExitMock).toHaveBeenCalledWith(0);
		});

		test('php should execute a file', async () => {
			const filePath = path.join(phpExampleDir, 'php-version.php');
			process.argv = ['node', 'wp-now', 'php', filePath];
			await runCli();
			expect(output).toMatch(/8\.0/i);
			expect(processExitMock).toHaveBeenCalledWith(0);
		});

		test('php should execute a file and change php version', async () => {
			const filePath = path.join(phpExampleDir, 'php-version.php');
			process.argv = [
				'node',
				'wp-now',
				'php',
				'--php=7.4',
				'--',
				filePath,
			];
			await runCli();
			expect(output).toMatch(/7\.4/i);
			expect(processExitMock).toHaveBeenCalledWith(0);
		});
	});

	/**
	 * Test startServer.
	 */
	describe('startServer', () => {
		let stopServer, options;

		beforeEach(async () => {
			const projectPath = path.join(
				tmpExampleDirectory,
				'theme-with-assets'
			);
			const config = await getWpNowConfig({ path: projectPath });
			const server = await startServer(config);
			stopServer = server.stopServer;
			options = server.options;
		});

		afterEach(async () => {
			options = null;
			await stopServer();
		});

		/**
		 * Test that startServer compresses the text files correctly.
		 */
		test.each([
			['html', ''],
			['css', '/wp-content/themes/theme-with-assets/style.css'],
			[
				'javascript',
				'/wp-content/themes/theme-with-assets/javascript.js',
			],
		])('startServer compresses the %s file', async (_, file) => {
			const req = await fetch(`${options.absoluteUrl}${file}`);
			expect(req.headers.get('content-encoding')).toBe('gzip');
		});

		/**
		 * Test that startServer doesn't compress non text files.
		 */
		test.each([
			['png', '/wp-content/themes/theme-with-assets/image.png'],
			['jpg', '/wp-content/themes/theme-with-assets/image.jpg'],
		])("startServer doesn't compress the %s file", async (_, file) => {
			const req = await fetch(`${options.absoluteUrl}${file}`);
			expect(req.headers.get('content-encoding')).toBe(null);
		});
	});

	/**
	 * Test blueprints execution.
	 */
	describe('blueprints', () => {
		const blueprintExamplesPath = path.join(__dirname, 'blueprints');

		afterEach(() => {
			// Clean the custom url from the SQLite database
			fs.rmSync(
				path.join(getWpNowTmpPath(), 'wp-content', 'playground'),
				{ recursive: true }
			);
		});

		test('setting wp-config variable WP_DEBUG_LOG through blueprint', async () => {
			const options = await getWpNowConfig({
				blueprint: path.join(blueprintExamplesPath, 'wp-debug.json'),
			});
			const { php, stopServer } = await startServer(options);
			php.writeFile(
				`${php.documentRoot}/print-constants.php`,
				`<?php echo WP_DEBUG_LOG;`
			);
			const result = await php.request({
				method: 'GET',
				url: '/print-constants.php',
			});
			expect(result.text).toMatch(
				'/var/www/html/wp-content/themes/fake/example.log'
			);
			await stopServer();
		});

		test('setting wp-config variable WP_SITEURL through blueprint', async () => {
			const options = await getWpNowConfig({
				blueprint: path.join(blueprintExamplesPath, 'wp-config.json'),
			});
			const { php, stopServer } = await startServer(options);
			expect(options.absoluteUrl).toBe('http://127.0.0.1');

			php.writeFile(
				`${php.documentRoot}/print-constants.php`,
				`<?php echo WP_SITEURL;`
			);
			const result = await php.request({
				method: 'GET',
				url: '/print-constants.php',
			});
			expect(result.text).toMatch('http://127.0.0.1');
			await stopServer();
		});
	});

	describe('reset', () => {
		let removeSyncSpy;
		beforeAll(() => {
			removeSyncSpy = vi
				.spyOn(fs, 'removeSync')
				.mockImplementation(() => {});
		});

		afterAll(() => {
			removeSyncSpy.mockRestore();
		});

		test('creates a new environment, destroying the old environment', async () => {
			const mode = 'theme';
			const projectPath = path.join(tmpExampleDirectory, mode);
			const rawOptions: CliOptions = {
				path: projectPath,
				reset: true,
			};
			const options = await getWpNowConfig(rawOptions);
			await startWPNow(options);
			const wpContentPathRegExp = new RegExp(
				`${getWpNowTmpPath()}\\/wp-content\\/${mode}-[\\w\\d]+`
			);

			expect(removeSyncSpy).toHaveBeenCalledWith(
				expect.stringMatching(wpContentPathRegExp)
			);
		});
	});
});

/**
 * Test wp-cli command.
 */
describe('wp-cli command', () => {
	let consoleSpy;
	let output = '';

	beforeEach(() => {
		function onStdout(outputLine: string) {
			output += outputLine;
		}
		consoleSpy = vi.spyOn(console, 'log');
		consoleSpy.mockImplementation(onStdout);
	});

	afterEach(() => {
		output = '';
		consoleSpy.mockRestore();
	});

	beforeAll(async () => {
		await downloadWithTimer('wp-cli', downloadWPCLI);
	});

	afterAll(() => {
		fs.removeSync(getWpCliTmpPath());
	});

	/**
	 * Test wp-cli displays the version.
	 * We don't need the WordPress context for this test.
	 */
	test('wp-cli displays the version', async () => {
		await executeWPCli(['cli', 'version']);
		expect(output).toMatch(/WP-CLI (\d\.?)+/i);
	});
});
