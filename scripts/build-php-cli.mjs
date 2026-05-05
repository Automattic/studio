import { spawnSync, execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const [
	targetPlatform = process.env.PHP_CLI_PLATFORM ||
		process.env.PHP_CLI_NODE_PLATFORM ||
		process.platform,
	targetArch = process.env.PHP_CLI_ARCH || process.env.PHP_CLI_NODE_ARCH || process.arch,
] = process.argv.slice( 2 );
const nodePlatform = buildkitePlatformToNode( targetPlatform );
const nodeArch = normalizeArch( targetArch );

const config = {
	nodePlatform,
	nodeArch,
	artifactPlatform: process.env.PHP_CLI_ARTIFACT_PLATFORM || platformToArtifact( nodePlatform ),
	artifactArch: process.env.PHP_CLI_ARTIFACT_ARCH || archToArtifact( nodeArch ),
	archiveExt: process.env.PHP_CLI_ARCHIVE_EXT || ( nodePlatform === 'win32' ? 'zip' : 'tar.gz' ),
	binaryName: process.env.PHP_CLI_BINARY_NAME || ( nodePlatform === 'win32' ? 'php.exe' : 'php' ),
	spcPkgOs: process.env.PHP_CLI_SPC_PKG_OS || spcPackageOs( nodePlatform ),
	spcTag: process.env.SPC_TAG || '2.8.5',
	spcDir: path.resolve( process.env.SPC_DIR || path.join( repoRoot, '.cache', 'static-php-cli' ) ),
	outputDir: path.resolve( process.env.OUTPUT_DIR || path.join( repoRoot, 'out', 'php-binaries' ) ),
};

const craftFile = path.join(
	repoRoot,
	'scripts',
	config.nodePlatform === 'win32' ? 'php-cli.windows.craft.yml' : 'php-cli.craft.yml'
);
const buildRoot = path.join(
	config.spcDir,
	`buildroot-${ config.nodePlatform }-${ config.nodeArch }`
);
const sourcePath = path.join(
	config.spcDir,
	`source-${ config.nodePlatform }-${ config.nodeArch }`
);
const pkgRoot = path.join(
	config.spcDir,
	'pkgroot',
	`${ config.artifactArch }-${ config.spcPkgOs }`
);

try {
	main();
} catch ( error ) {
	copySpcLogsToArtifacts();
	console.error( error instanceof Error ? error.message : error );
	process.exit( 1 );
}

function main() {
	assertHostMatchesTarget();
	prepareStaticPhpCli();
	installHostRuntime();
	installStaticPhpCliDependencies();
	cleanBuildPaths();
	runCraft();
	packageArtifact();
}

function run( command, args, options = {} ) {
	const result = spawnSync( command, args, {
		cwd: repoRoot,
		stdio: 'inherit',
		shell: process.platform === 'win32',
		...options,
	} );

	if ( result.error ) {
		throw result.error;
	}

	if ( result.status !== 0 ) {
		throw new Error(
			`${ [ command, ...args ].join( ' ' ) } failed with ${
				result.signal ? `signal ${ result.signal }` : `exit code ${ result.status ?? 1 }`
			}.`
		);
	}
}

function commandExists( command ) {
	return (
		spawnSync( 'bash', [ '-lc', `command -v ${ command } >/dev/null 2>&1` ], {
			stdio: 'ignore',
		} ).status === 0
	);
}

function assertHostMatchesTarget() {
	if ( process.platform !== config.nodePlatform ) {
		throw new Error(
			`PHP CLI build expected ${ config.nodePlatform }, found ${ process.platform }.`
		);
	}

	if ( normalizeArch( process.arch ) !== config.nodeArch ) {
		throw new Error( `PHP CLI build expected ${ config.nodeArch }, found ${ process.arch }.` );
	}
}

function installHostRuntime() {
	if ( config.nodePlatform === 'darwin' ) {
		installMacHostRuntime();
		return;
	}

	if ( config.nodePlatform === 'win32' ) {
		installWindowsHostRuntime();
		return;
	}

	throw new Error( `Unsupported PHP CLI build platform: ${ config.nodePlatform }.` );
}

function installMacHostRuntime() {
	if ( ! commandExists( 'brew' ) ) {
		throw new Error( 'Homebrew is required to install the PHP host runtime.' );
	}

	installBrewFormulaIfMissing( 'php@8.4' );
	process.env.PATH = `/opt/homebrew/opt/php@8.4/bin:/opt/homebrew/opt/php@8.4/sbin:${ process.env.PATH }`;
	installBrewFormulaIfMissing( 'composer' );
}

function installWindowsHostRuntime() {
	console.log( '--- :windows: Installing static-php-cli runtime' );
	run(
		'powershell.exe',
		[
			'-NoProfile',
			'-ExecutionPolicy',
			'Bypass',
			'-File',
			path.join( config.spcDir, 'bin', 'setup-runtime.ps1' ),
		],
		{ cwd: config.spcDir, shell: false }
	);

	const runtimeDir = path.join( config.spcDir, 'runtime' );
	if ( ! fs.existsSync( path.join( runtimeDir, 'php.exe' ) ) ) {
		throw new Error( `static-php-cli runtime PHP was not installed at ${ runtimeDir }.` );
	}

	process.env.PATH = `${ runtimeDir }${ path.delimiter }${ process.env.PATH }`;
}

function installBrewFormulaIfMissing( formula ) {
	const result = spawnSync( 'brew', [ 'list', '--formula', formula ], {
		stdio: 'ignore',
	} );

	if ( result.status === 0 ) {
		return;
	}

	console.log( `--- :homebrew: Installing ${ formula }` );
	run( 'brew', [ 'install', formula ] );
}

function prepareStaticPhpCli() {
	if ( ! fs.existsSync( path.join( config.spcDir, '.git' ) ) ) {
		run( 'git', [
			'clone',
			'--depth',
			'1',
			'--branch',
			config.spcTag,
			'https://github.com/crazywhalecc/static-php-cli.git',
			config.spcDir,
		] );
	} else {
		run( 'git', [ '-C', config.spcDir, 'fetch', '--depth', '1', 'origin', config.spcTag ] );
		run( 'git', [ '-C', config.spcDir, 'checkout', '--detach', 'FETCH_HEAD' ] );
		run( 'git', [ '-C', config.spcDir, 'reset', '--hard' ] );
	}
}

function installStaticPhpCliDependencies() {
	console.log( '--- :composer: Installing static-php-cli dependencies' );
	const composerArgs = [
		'--working-dir',
		config.spcDir,
		'install',
		'--no-dev',
		'--no-interaction',
		'--prefer-dist',
	];

	if ( config.nodePlatform === 'win32' ) {
		run(
			path.join( config.spcDir, 'runtime', 'php.exe' ),
			[ path.join( config.spcDir, 'runtime', 'composer.phar' ), ...composerArgs ],
			{ shell: false }
		);
		return;
	}

	run( 'composer', composerArgs );
}

function cleanBuildPaths() {
	console.log( '--- :broom: Cleaning PHP CLI build paths' );
	fs.rmSync( buildRoot, { recursive: true, force: true } );
	fs.rmSync( sourcePath, { recursive: true, force: true } );
	fs.rmSync( pkgRoot, { recursive: true, force: true } );
}

function runCraft() {
	console.log( '--- :elephant: Building PHP CLI' );
	run( 'npm', [ 'run', craftScriptName() ], {
		env: {
			...process.env,
			BUILD_ROOT_PATH: buildRoot,
			SOURCE_PATH: sourcePath,
			PKG_ROOT_PATH: pkgRoot,
		},
	} );
}

function packageArtifact() {
	const phpVersion = readPhpVersion();
	const phpBin = path.join( buildRoot, 'bin', config.binaryName );

	if ( ! fs.existsSync( phpBin ) ) {
		throw new Error( `PHP binary was not built at ${ phpBin }.` );
	}

	if ( config.nodePlatform !== 'win32' ) {
		run( 'file', [ phpBin ] );
	}
	const versionOutput = execFileSync( phpBin, [ '--version' ], { encoding: 'utf8' } );
	if ( ! versionOutput.includes( `PHP ${ phpVersion } ` ) ) {
		throw new Error( `Built PHP binary does not report PHP ${ phpVersion }.` );
	}
	console.log( versionOutput.trim() );

	console.log( '--- :package: Packaging PHP CLI artifact' );
	fs.mkdirSync( config.outputDir, { recursive: true } );

	const artifactPath = path.join(
		config.outputDir,
		`php-${ phpVersion }-cli-${ config.artifactPlatform }-${ config.artifactArch }.${ config.archiveExt }`
	);
	const hashPath = `${ artifactPath }.sha256`;
	const packageDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-php-cli-' ) );

	try {
		const packageBin = path.join( packageDir, config.binaryName );
		fs.copyFileSync( phpBin, packageBin );
		if ( config.nodePlatform !== 'win32' ) {
			fs.chmodSync( packageBin, 0o755 );
		}
		fs.rmSync( artifactPath, { force: true } );
		fs.rmSync( hashPath, { force: true } );

		if ( config.archiveExt === 'tar.gz' ) {
			run( 'tar', [ '-czf', artifactPath, '-C', packageDir, config.binaryName ] );
		} else if ( config.archiveExt === 'zip' ) {
			run(
				'powershell.exe',
				[
					'-NoProfile',
					'-ExecutionPolicy',
					'Bypass',
					'-Command',
					`Compress-Archive -LiteralPath ${ quotePowerShell(
						packageBin
					) } -DestinationPath ${ quotePowerShell( artifactPath ) } -Force`,
				],
				{ shell: false }
			);
		} else {
			throw new Error( `Unsupported PHP CLI archive extension: ${ config.archiveExt }.` );
		}

		fs.writeFileSync( hashPath, `${ sha256( artifactPath ) }\n` );
	} finally {
		fs.rmSync( packageDir, { recursive: true, force: true } );
	}

	console.log( `Created ${ artifactPath }` );
	console.log( `Created ${ hashPath }` );
}

function copySpcLogsToArtifacts() {
	const logDir = path.join( config.spcDir, 'log' );
	if ( ! fs.existsSync( logDir ) ) {
		return;
	}

	fs.mkdirSync( config.outputDir, { recursive: true } );
	for ( const logName of [ 'spc.output.log', 'spc.shell.log' ] ) {
		const logPath = path.join( logDir, logName );
		if ( fs.existsSync( logPath ) ) {
			fs.copyFileSync( logPath, path.join( config.outputDir, logName ) );
		}
	}
}

function readPhpVersion() {
	const craft = fs.readFileSync( craftFile, 'utf8' );
	const match = craft.match( /^php-version:\s*(.+)\s*$/m );
	if ( ! match ) {
		throw new Error( `Could not read php-version from ${ craftFile }.` );
	}
	return match[ 1 ].trim();
}

function craftScriptName() {
	return config.nodePlatform === 'win32' ? 'php-cli:craft:windows' : 'php-cli:craft';
}

function quotePowerShell( value ) {
	return `'${ value.replaceAll( "'", "''" ) }'`;
}

function sha256( filePath ) {
	return createHash( 'sha256' ).update( fs.readFileSync( filePath ) ).digest( 'hex' );
}

function normalizeArch( arch ) {
	return arch === 'arm64' || arch === 'aarch64' ? 'arm64' : arch;
}

function archToArtifact( arch ) {
	return normalizeArch( arch ) === 'arm64' ? 'aarch64' : 'x86_64';
}

function platformToArtifact( platform ) {
	return (
		{
			darwin: 'macos',
			win32: 'windows',
		}[ platform ] || platform
	);
}

function spcPackageOs( platform ) {
	return (
		{
			darwin: 'darwin',
			win32: 'windows',
		}[ platform ] || platform
	);
}

function buildkitePlatformToNode( platform ) {
	return (
		{
			mac: 'darwin',
			windows: 'win32',
		}[ platform ] || platform
	);
}
