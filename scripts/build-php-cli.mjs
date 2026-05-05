import { spawnSync, execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );

const config = {
	nodePlatform: process.env.PHP_CLI_NODE_PLATFORM || process.platform,
	nodeArch: process.env.PHP_CLI_NODE_ARCH || process.arch,
	artifactPlatform: process.env.PHP_CLI_ARTIFACT_PLATFORM || platformToArtifact( process.platform ),
	artifactArch: process.env.PHP_CLI_ARTIFACT_ARCH || archToArtifact( process.arch ),
	archiveExt:
		process.env.PHP_CLI_ARCHIVE_EXT || ( process.platform === 'win32' ? 'zip' : 'tar.gz' ),
	binaryName:
		process.env.PHP_CLI_BINARY_NAME || ( process.platform === 'win32' ? 'php.exe' : 'php' ),
	spcPkgOs: process.env.PHP_CLI_SPC_PKG_OS || spcPackageOs( process.platform ),
	spcTag: process.env.SPC_TAG || '2.8.5',
	spcDir: path.resolve( process.env.SPC_DIR || path.join( repoRoot, '.cache', 'static-php-cli' ) ),
	outputDir: path.resolve( process.env.OUTPUT_DIR || path.join( repoRoot, 'out', 'php-binaries' ) ),
};

const craftFile = path.join( repoRoot, 'scripts', 'php-cli.craft.yml' );
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
	installHostRuntime();
	prepareStaticPhpCli();
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

	if ( result.status !== 0 ) {
		process.exit( result.status ?? 1 );
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
	if ( config.nodePlatform !== 'darwin' ) {
		throw new Error( `Unsupported PHP CLI build platform: ${ config.nodePlatform }.` );
	}

	if ( ! commandExists( 'brew' ) ) {
		throw new Error( 'Homebrew is required to install the PHP host runtime.' );
	}

	installBrewFormulaIfMissing( 'php@8.4' );
	process.env.PATH = `/opt/homebrew/opt/php@8.4/bin:/opt/homebrew/opt/php@8.4/sbin:${ process.env.PATH }`;
	installBrewFormulaIfMissing( 'composer' );
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

	console.log( '--- :composer: Installing static-php-cli dependencies' );
	run( 'composer', [
		'--working-dir',
		config.spcDir,
		'install',
		'--no-dev',
		'--no-interaction',
		'--prefer-dist',
	] );
}

function cleanBuildPaths() {
	console.log( '--- :broom: Cleaning PHP CLI build paths' );
	fs.rmSync( buildRoot, { recursive: true, force: true } );
	fs.rmSync( sourcePath, { recursive: true, force: true } );
}

function runCraft() {
	console.log( '--- :elephant: Building PHP CLI' );
	run( 'npm', [ 'run', 'php-cli:craft' ], {
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

	run( 'file', [ phpBin ] );
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
		fs.chmodSync( packageBin, 0o755 );
		fs.rmSync( artifactPath, { force: true } );
		fs.rmSync( hashPath, { force: true } );

		if ( config.archiveExt !== 'tar.gz' ) {
			throw new Error( `Unsupported PHP CLI archive extension: ${ config.archiveExt }.` );
		}

		run( 'tar', [ '-czf', artifactPath, '-C', packageDir, config.binaryName ] );
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
	return platform === 'darwin' ? 'macos' : platform;
}

function spcPackageOs( platform ) {
	return platform === 'darwin' ? 'darwin' : platform;
}
