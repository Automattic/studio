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

function runCapture( command, args, options = {} ) {
	const result = spawnSync( command, args, {
		cwd: repoRoot,
		encoding: 'utf8',
		shell: false,
		...options,
	} );

	if ( result.error || result.status !== 0 ) {
		return '';
	}

	return result.stdout.trim();
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
	ensureWindowsVisualStudio();
	patchStaticPhpCliWindowsSourceExtraction();
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

function ensureWindowsVisualStudio() {
	let visualStudio = findWindowsVisualStudio();

	if ( ! visualStudio || ! hasWindowsCppCompiler( visualStudio ) ) {
		installWindowsBuildTools();
		visualStudio = findWindowsVisualStudio();
	}

	if ( ! visualStudio ) {
		throw new Error(
			'Visual Studio was not found after installing Build Tools. Check the Visual Studio installer output above.'
		);
	}

	if ( ! hasWindowsCppCompiler( visualStudio ) ) {
		throw new Error(
			`Visual Studio was found at ${ visualStudio.rootDir }, but cl.exe was not installed.`
		);
	}

	patchStaticPhpCliVisualStudioDetection( visualStudio );
}

function hasWindowsCppCompiler( visualStudio ) {
	const msvcDir = path.win32.join( visualStudio.rootDir, 'VC', 'Tools', 'MSVC' );

	if ( ! fs.existsSync( msvcDir ) ) {
		return false;
	}

	return fs
		.readdirSync( msvcDir, { withFileTypes: true } )
		.some( ( entry ) =>
			fs.existsSync( path.win32.join( msvcDir, entry.name, 'bin', 'Hostx64', 'x64', 'cl.exe' ) )
		);
}

function findWindowsVisualStudio() {
	const vswhereInstall = findWindowsVisualStudioWithVswhere();
	if ( vswhereInstall ) {
		return vswhereInstall;
	}

	const installs = [
		{
			edition: 'BuildTools',
			version: 'vs17',
			rootDir: 'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools',
			msbuild:
				'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools\\MSBuild\\Current\\Bin\\MSBuild.exe',
		},
		{
			edition: 'Community',
			version: 'vs17',
			rootDir: 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
			msbuild:
				'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\MSBuild\\Current\\Bin\\MSBuild.exe',
		},
		{
			edition: 'Professional',
			version: 'vs17',
			rootDir: 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional',
			msbuild:
				'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\MSBuild\\Current\\Bin\\MSBuild.exe',
		},
		{
			edition: 'Enterprise',
			version: 'vs17',
			rootDir: 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise',
			msbuild:
				'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\MSBuild\\Current\\Bin\\MSBuild.exe',
		},
		{
			edition: 'BuildTools',
			version: 'vs17',
			rootDir: 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools',
			msbuild:
				'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\MSBuild\\Current\\Bin\\MSBuild.exe',
		},
		{
			edition: 'BuildTools',
			version: 'vs16',
			rootDir: 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools',
			msbuild:
				'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools\\MSBuild\\Current\\Bin\\MSBuild.exe',
		},
		{
			edition: 'Community',
			version: 'vs16',
			rootDir: 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community',
			msbuild:
				'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community\\MSBuild\\Current\\Bin\\MSBuild.exe',
		},
		{
			edition: 'Professional',
			version: 'vs16',
			rootDir: 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Professional',
			msbuild:
				'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Professional\\MSBuild\\Current\\Bin\\MSBuild.exe',
		},
		{
			edition: 'Enterprise',
			version: 'vs16',
			rootDir: 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Enterprise',
			msbuild:
				'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Enterprise\\MSBuild\\Current\\Bin\\MSBuild.exe',
		},
	];

	return installs.find( ( install ) => fs.existsSync( install.msbuild ) );
}

function findWindowsVisualStudioWithVswhere() {
	const vswhere = [
		'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe',
		'C:\\Program Files\\Microsoft Visual Studio\\Installer\\vswhere.exe',
	].find( ( candidate ) => fs.existsSync( candidate ) );

	if ( ! vswhere ) {
		return;
	}

	const output = runCapture( vswhere, [
		'-latest',
		'-products',
		'*',
		'-requires',
		'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
		'-format',
		'json',
		'-utf8',
	] );

	if ( ! output ) {
		return;
	}

	let installs;
	try {
		installs = JSON.parse( output.replace( /^\uFEFF/, '' ) );
	} catch {
		return;
	}
	const install = installs.find( ( item ) => item.installationPath );
	if ( ! install ) {
		return;
	}

	const rootDir = install.installationPath;
	const msbuild = path.win32.join( rootDir, 'MSBuild', 'Current', 'Bin', 'MSBuild.exe' );
	if ( ! fs.existsSync( msbuild ) ) {
		return;
	}

	const majorVersion = Number.parseInt( install.installationVersion, 10 );
	return {
		edition: install.productId?.split( '.' ).at( -1 ) || 'Unknown',
		version: majorVersion >= 17 || rootDir.includes( '\\2022\\' ) ? 'vs17' : 'vs16',
		rootDir,
		msbuild,
	};
}

function installWindowsBuildTools() {
	console.log( '--- :windows: Installing Visual Studio 2022 Build Tools' );
	const installerPath = path.join( os.tmpdir(), 'vs_BuildTools.exe' );
	run(
		'powershell.exe',
		[
			'-NoProfile',
			'-ExecutionPolicy',
			'Bypass',
			'-Command',
			[
				`$installer = ${ quotePowerShell( installerPath ) }`,
				"Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vs_BuildTools.exe' -OutFile $installer",
				"$arguments = @('--quiet', '--wait', '--norestart', '--nocache', '--installPath', 'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools', '--add', 'Microsoft.VisualStudio.Workload.VCTools', '--includeRecommended')",
				'$process = Start-Process -FilePath $installer -ArgumentList $arguments -Wait -PassThru',
				'if ( @( 0, 3010 ) -notcontains $process.ExitCode ) { exit $process.ExitCode }',
			].join( '; ' ),
		],
		{ shell: false }
	);
}

function patchStaticPhpCliVisualStudioDetection( visualStudio ) {
	const systemUtilPath = path.join(
		config.spcDir,
		'src',
		'SPC',
		'builder',
		'windows',
		'SystemUtil.php'
	);
	const systemUtil = fs.readFileSync( systemUtilPath, 'utf8' );

	if ( systemUtil.includes( visualStudio.msbuild ) ) {
		return;
	}

	const needle = '        $check_path = [\n';
	const replacement =
		needle +
		`            '${ escapePhpSingleQuotedString( visualStudio.msbuild ) }' => '${
			visualStudio.version
		}',\n`;

	if ( ! systemUtil.includes( needle ) ) {
		throw new Error(
			`Could not patch Visual Studio Build Tools detection in ${ systemUtilPath }.`
		);
	}

	fs.writeFileSync( systemUtilPath, systemUtil.replace( needle, replacement ) );
}

function escapePhpSingleQuotedString( value ) {
	return value.replaceAll( '\\', '\\\\' ).replaceAll( "'", "\\'" );
}

function patchStaticPhpCliWindowsSourceExtraction() {
	const fileSystemPath = path.join( config.spcDir, 'src', 'SPC', 'store', 'FileSystem.php' );
	const fileSystem = fs.readFileSync( fileSystemPath, 'utf8' );

	if ( fileSystem.includes( 'SPC_WINDOWS_CREATE_SOURCE_TARGET' ) ) {
		return;
	}

	const needle = `        if (!is_dir($dir = dirname($target))) {
            self::createDir($dir);
        }
        try {
            self::extractWithType($source_type, $filename, $move_path);
`;
	const replacement = `        if (!is_dir($dir = dirname($target))) {
            self::createDir($dir);
        }
        /* SPC_WINDOWS_CREATE_SOURCE_TARGET */
        if (PHP_OS_FAMILY === 'Windows' && !is_dir($target)) {
            self::createDir($target);
        }
        try {
            self::extractWithType($source_type, $filename, $move_path);
`;

	if ( ! fileSystem.includes( needle ) ) {
		throw new Error( `Could not patch Windows source extraction in ${ fileSystemPath }.` );
	}

	let patchedFileSystem = fileSystem.replace( needle, replacement );

	const tarNeedle = `            // Yeah, I will be an MS HATER !
            match (self::extname($filename)) {
                'tar' => f_passthru("tar -xf {$filename} -C {$target} --strip-components 1"),
                'xz', 'txz', 'gz', 'tgz', 'bz2' => cmd()->execWithResult("\\"{$_7z}\\" x -so {$filename} | tar -f - -x -C \\"{$target}\\" --strip-components 1"),
                'zip' => self::unzipWithStrip($filename, $target),
`;
	const tarReplacement = `            // Yeah, I will be an MS HATER !
            /* SPC_WINDOWS_TAR_FORWARD_SLASH_TARGET */
            $tar_target = str_replace('\\\\', '/', $target);
            match (self::extname($filename)) {
                'tar' => f_passthru("tar -xf {$filename} -C {$tar_target} --strip-components 1"),
                'xz', 'txz', 'gz', 'tgz', 'bz2' => cmd()->execWithResult("\\"{$_7z}\\" x -so {$filename} | tar -f - -x -C \\"{$tar_target}\\" --strip-components 1"),
                'zip' => self::unzipWithStrip($filename, $target),
`;

	if ( ! patchedFileSystem.includes( 'SPC_WINDOWS_TAR_FORWARD_SLASH_TARGET' ) ) {
		if ( ! patchedFileSystem.includes( tarNeedle ) ) {
			throw new Error( `Could not patch Windows tar target in ${ fileSystemPath }.` );
		}
		patchedFileSystem = patchedFileSystem.replace( tarNeedle, tarReplacement );
	}

	fs.writeFileSync( fileSystemPath, patchedFileSystem );
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
