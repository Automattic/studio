import { downloadWpCli } from './download';
import { rootCertificates } from 'tls';
import getWpCliPath from './get-wp-cli-path';
import getWpNowConfig from './config';
import { DEFAULT_PHP_VERSION, DEFAULT_WORDPRESS_VERSION } from './constants';
import { phpVar } from '@php-wasm/util';
import { createNodeFsMountHandler, loadNodeRuntime } from '@php-wasm/node';
import { getSqliteCommandPath } from '../../../src/lib/sqlite-command-versions';
import { PHP, MountHandler, writeFiles, setPhpIniEntries, loadPHPRuntime } from '@php-wasm/universal';
import { readFileSync } from 'fs';

const isWindows = process.platform === 'win32';

/**
 * This is an unstable API. Multiple wp-cli commands may not work due to a current limitation on php-wasm and pthreads.
 */
export async function executeWPCli( projectPath: string, args: string[] ): Promise<{ stdout: string; stderr: string; exitCode: number; }> {
	await downloadWpCli();
	let options = await getWpNowConfig({
		php: DEFAULT_PHP_VERSION,
		wp: DEFAULT_WORDPRESS_VERSION,
		path: projectPath,
	});

	const id =  await loadNodeRuntime(options.phpVersion);
	const php = new PHP(id);
	php.mkdir(options.documentRoot);
	await php.mount(options.documentRoot, createNodeFsMountHandler(projectPath) as unknown as MountHandler);

	//Set the SAPI name to cli before running the script
	await php.setSapiName('cli');

	php.mkdir('/tmp');

	const wpCliPath = '/tmp/wp-cli.phar';
	const stderrPath = '/tmp/stderr';
	const sqliteCommandPath = '/tmp/sqlite-command';
	const runCliPath =  '/tmp/run-cli.php';
	const createFiles = {
			[wpCliPath]: readFileSync(getWpCliPath()),
			[stderrPath]: '',
			[runCliPath]: `<?php
			// Set up the environment to emulate a shell script
			// call.

			// Set SHELL_PIPE to 0 to ensure WP-CLI formats
			// the output as ASCII tables.
			// @see https://github.com/wp-cli/wp-cli/issues/1102
			putenv( 'SHELL_PIPE=0' );

			// When running PHP on Playground, the value of constant PHP_OS is set to Linux.
			// This implies that platform-specific logic won't work as expected. To solve this,
			// we use an environment variable to ensure WP-CLI runs the Windows-specific logic.
			putenv( 'WP_CLI_TEST_IS_WINDOWS=${isWindows ? 1 : 0}' );

			// Set the argv global.
			$GLOBALS['argv'] = array_merge([
				"${wpCliPath}",
				"--path=${options.documentRoot}"
			], ${phpVar(args)});

			// Provide stdin, stdout, stderr streams outside of
			// the CLI SAPI.
			define('STDIN', fopen('php://stdin', 'rb'));
			define('STDOUT', fopen('php://stdout', 'wb'));
			define('STDERR', fopen('${stderrPath}', 'wb'));
			
			// Force disabling WordPress debugging mode to avoid parsing issues of WP-CLI command result
			define('WP_DEBUG', false);
			// Filter out errors below ERROR level to avoid parsing issues of WP-CLI command result
			error_reporting(E_ERROR);

			// WP-CLI uses this argument for checking updates. Seems it's not defined by Playground
			// when running a script, so we explicitly set it.
			// Reference: https://github.com/wp-cli/wp-cli/blob/main/php/WP_CLI/Runner.php#L1889
			$_SERVER['argv'][0] = '${wpCliPath}';

			require( '${wpCliPath}' );`,
			['/internal/shared/ca-bundle.crt']: rootCertificates.join('\n')
	}

	await writeFiles(php, '/', createFiles);

	await setPhpIniEntries(php, {
		'openssl.cafile': '/internal/shared/ca-bundle.crt'
	});
	try{
		php.mkdir(sqliteCommandPath);
		await php.mount(sqliteCommandPath, createNodeFsMountHandler(getSqliteCommandPath()) as unknown as MountHandler)
	}catch(e){
		console.log(e)
	}

	try {
		php.chdir(options.documentRoot);
		const result = await php.run({
			scriptPath: runCliPath,
		});
		const stderr = php.readFileAsText(stderrPath).replace('PHP.run() output was: #!/usr/bin/env php', '').trim();
		return { stdout: result.text.replace('#!/usr/bin/env php', '').trim(), stderr, exitCode: result.exitCode };
	} catch (error) {
		const stderr = php.readFileAsText(stderrPath).replace('PHP.run() output was: #!/usr/bin/env php', '').trim();
		return { stdout: '', stderr: stderr, exitCode: 1 };
	} finally {
		php.exit()
	}
}
