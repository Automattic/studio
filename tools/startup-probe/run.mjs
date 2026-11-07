import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create as createTar, extract as extractTar } from 'tar';

const repo = path.resolve( import.meta.dirname, '../..' );
const artifacts = path.join( repo, 'test-results/startup-probe' );
const builds = path.join( repo, 'apps/cli/dist/startup-probe' );
const root = fs.mkdtempSync( path.join( os.tmpdir(), 'stu-1622-' ) );
const phpVersion = '8.3';
const products = Number( process.env.STARTUP_PROBE_PRODUCTS || 5000 );
const plugins = JSON.parse(
	fs.readFileSync( path.join( import.meta.dirname, 'plugins.json' ), 'utf8' )
);
const summary = {
	platform: process.platform,
	architecture: process.arch,
	osRelease: os.release(),
	cpu: os.cpus()[ 0 ]?.model,
	logicalCpus: os.availableParallelism(),
	memoryGiB: os.totalmem() / 1024 ** 3,
	node: process.version,
	phpRequested: phpVersion,
	commits: JSON.parse( fs.readFileSync( path.join( builds, 'commits.json' ), 'utf8' ) ),
	plugins,
	fixture: null,
	measurements: [],
	errors: [],
	limitations: [
		'Synthetic products and default plugin settings; no customer backup or external service credentials.',
		'Local backup import exercises the importer and server startup used by the legacy pull; remote download is not tested.',
		'OS locale and filesystem cache are not controlled; site paths contain Japanese characters.',
	],
};
fs.mkdirSync( artifacts, { recursive: true } );

if ( process.env.STARTUP_PROBE_REQUIRE_WINDOWS === '1' ) {
	assert.equal( process.platform, 'win32', 'This CI experiment must run on real Windows.' );
}

function saveSummary() {
	fs.writeFileSync(
		path.join( artifacts, 'summary.json' ),
		JSON.stringify( summary, null, 2 ) + '\n'
	);
}

function environment( name, variant ) {
	const dir = path.join( root, name );
	const config = path.join( dir, 'config' );
	fs.mkdirSync( config, { recursive: true } );
	fs.symlinkSync(
		path.join( os.homedir(), '.studio/server-files' ),
		path.join( config, 'server-files' ),
		'junction'
	);
	const fixturePhp = path.join( root, 'fixture/config/php-bin' );
	if ( name !== 'fixture' && fs.existsSync( fixturePhp ) ) {
		fs.cpSync( fixturePhp, path.join( config, 'php-bin' ), {
			recursive: true,
			mode: fs.constants.COPYFILE_FICLONE,
		} );
	}
	fs.writeFileSync(
		path.join( config, 'cli.json' ),
		JSON.stringify( {
			version: 1,
			sites: [],
			snapshots: [],
			lastDependencyCheckTime: Date.now(),
		} )
	);
	return {
		name,
		cli: path.join( builds, variant, 'main.mjs' ),
		site: path.join( dir, 'サイト検証' ),
		config,
		vars: {
			...process.env,
			DEV_CONFIG_DIR: config,
			STUDIO_PROCESS_MANAGER_HOME: path.join( root, name.slice( 0, 3 ) + '-daemon' ),
			E2E: '1',
			E2E_APP_DATA_PATH: dir,
			STARTUP_PROBE_PRODUCTS: String( products ),
		},
	};
}

async function cli( env, label, args, timeoutMs = 360_000 ) {
	console.log( `PROBE ${ env.name }: ${ label }` );
	const log = fs.createWriteStream( path.join( artifacts, `${ env.name }-${ label }.log` ) );
	const started = performance.now();
	let stdout = '';
	let stderr = '';
	let startPhase;
	let endPhase;
	let progressTail = '';
	let timedOut = false;
	const child = spawn( process.execPath, [ env.cli, ...args ], {
		env: env.vars,
		stdio: [ 'ignore', 'pipe', 'pipe' ],
	} );
	const timer = setTimeout( () => {
		timedOut = true;
		child.kill( 'SIGKILL' );
	}, timeoutMs );
	child.stdout.on( 'data', ( data ) => {
		stdout += data;
		log.write( `${ new Date().toISOString() } stdout ${ data }` );
	} );
	child.stderr.on( 'data', ( data ) => {
		const text = data.toString();
		stderr += text;
		progressTail = ( progressTail + text ).slice( -4000 );
		log.write( `${ new Date().toISOString() } stderr ${ text }` );
		if ( startPhase === undefined && progressTail.includes( 'Starting WordPress server' ) ) {
			startPhase = performance.now();
		}
		if ( endPhase === undefined && progressTail.includes( 'WordPress server started' ) ) {
			endPhase = performance.now();
		}
	} );
	const code = await new Promise( ( resolve, reject ) => {
		child.once( 'error', reject );
		child.once( 'close', resolve );
	} ).finally( () => {
		clearTimeout( timer );
		log.end();
	} );
	const result = {
		code,
		timedOut,
		elapsedMs: performance.now() - started,
		startupPhaseMs:
			startPhase !== undefined && endPhase !== undefined ? endPhase - startPhase : null,
		stdout,
		stderr,
	};
	console.log(
		`PROBE ${ env.name }: ${ label } exit=${ code } elapsed=${ result.elapsedMs.toFixed(
			0
		) }ms startup=${ result.startupPhaseMs?.toFixed( 0 ) ?? 'n/a' }ms`
	);
	return result;
}

function succeeded( result, label ) {
	assert.equal(
		result.code,
		0,
		`${ label }: ${ result.stderr.slice( -6000 ) }\n${ result.stdout.slice( -2000 ) }`
	);
	return result;
}

function marker( output, name ) {
	const line = output.split( /\r?\n/ ).find( ( value ) => value.startsWith( name ) );
	assert.ok( line, `Missing ${ name } marker` );
	return JSON.parse( line.slice( name.length ) );
}

async function create( env ) {
	succeeded(
		await cli( env, 'create', [
			'site',
			'create',
			'--name',
			'Startup Probe',
			'--path',
			env.site,
			'--wp',
			'latest',
			'--php',
			phpVersion,
			'--skip-browser',
			'--skip-log-details',
		] ),
		'create site'
	);
}

async function stopSite( env, label = 'stop' ) {
	succeeded( await cli( env, label, [ 'site', 'stop', '--path', env.site ] ), label );
}

async function checkSite( env, label ) {
	const result = succeeded(
		await cli( env, `${ label }-verify`, [
			'wp',
			'eval-file',
			path.join( import.meta.dirname, 'verify.php' ),
			'--path',
			env.site,
		] ),
		'verify restored site'
	);
	const data = marker( result.stdout, 'STUDIO_PROBE_VERIFY=' );
	assert.equal( data.products, products );
	assert.ok( data.php.startsWith( phpVersion + '.' ), `Unexpected PHP version: ${ data.php }` );
	assert.equal( data.active_plugins.length, summary.fixture.active_plugins.length );
	assert.deepEqual(
		[ ...data.active_plugins ].sort(),
		[ ...summary.fixture.active_plugins ].sort()
	);
	const config = JSON.parse( fs.readFileSync( path.join( env.config, 'cli.json' ), 'utf8' ) );
	const site = config.sites.find( ( candidate ) => candidate.path === env.site );
	assert.ok( site?.port, 'Missing running site port' );
	const url = `http://localhost:${ site.port }/`;
	const homepageStarted = performance.now();
	const response = await fetch( url, { signal: AbortSignal.timeout( 300_000 ) } );
	assert.equal( response.status, 200, `Homepage returned HTTP ${ response.status }` );
	assert.equal( new URL( response.url ).host, new URL( url ).host );
	await response.body?.cancel();
	data.homepageStatus = response.status;
	data.homepageElapsedMs = performance.now() - homepageStarted;
	return data;
}

async function cleanup( env ) {
	await cli( env, 'cleanup', [ 'site', 'stop', '--all' ], 60_000 ).catch( () => {} );
	const logs = path.join( env.vars.STUDIO_PROCESS_MANAGER_HOME, 'logs' );
	if ( fs.existsSync( logs ) ) {
		fs.cpSync( logs, path.join( artifacts, `${ env.name }-daemon` ), { recursive: true } );
	}
}

const setup = environment( 'fixture', 'draft' );
try {
	const downloads = path.join( root, 'downloads' );
	fs.mkdirSync( downloads );
	for ( const plugin of plugins ) {
		const response = await fetch( plugin.download_link, {
			signal: AbortSignal.timeout( 120_000 ),
		} );
		assert.ok( response.ok, `Download ${ plugin.slug }: HTTP ${ response.status }` );
		const bytes = Buffer.from( await response.arrayBuffer() );
		const archiveSha256 = createHash( 'sha256' ).update( bytes ).digest( 'hex' );
		assert.equal( archiveSha256, plugin.sha256, `Archive checksum changed for ${ plugin.slug }` );
		plugin.archive = path.join( downloads, plugin.slug + '.zip' );
		fs.writeFileSync( plugin.archive, bytes );
	}
	await create( setup );
	await stopSite( setup, 'stop-before-plugins' );
	for ( const plugin of plugins ) {
		succeeded(
			await cli(
				setup,
				`install-${ plugin.slug }`,
				[ 'wp', 'plugin', 'install', plugin.archive, '--activate', '--path', setup.site ],
				600_000
			),
			`install ${ plugin.slug }`
		);
	}
	const seed = succeeded(
		await cli(
			setup,
			'seed',
			[ 'wp', 'eval-file', path.join( import.meta.dirname, 'seed.php' ), '--path', setup.site ],
			900_000
		),
		'seed products'
	);
	summary.fixture = marker( seed.stdout, 'STUDIO_PROBE_FIXTURE=' );
	assert.equal( summary.fixture.active_plugins.length, plugins.length );
	const versions = succeeded(
		await cli( setup, 'plugin-versions', [
			'wp',
			'plugin',
			'list',
			'--fields=name,status,version',
			'--format=json',
			'--path',
			setup.site,
		] ),
		'read plugin versions'
	);
	summary.installedPlugins = JSON.parse( versions.stdout );
	for ( const plugin of plugins ) {
		const installed = summary.installedPlugins.find( ( p ) => p.name === plugin.slug );
		assert.equal( installed?.version, plugin.version );
		assert.equal( installed?.status, 'active' );
	}
	const backup = path.join( root, 'plugin-heavy.tar.gz' );
	succeeded(
		await cli(
			setup,
			'export',
			[ 'export', backup, '--path', setup.site, '--split-db-dump-by-table' ],
			900_000
		),
		'export fixture'
	);
	const exported = path.join( root, 'exported' );
	fs.mkdirSync( exported );
	await extractTar( { file: backup, cwd: exported } );
	const metaPath = path.join( exported, 'meta.json' );
	const meta = JSON.parse( fs.readFileSync( metaPath, 'utf8' ) );
	summary.exportedPhpMetadata = meta.phpVersion;
	meta.phpVersion = phpVersion;
	fs.writeFileSync( metaPath, JSON.stringify( meta ) );
	await createTar( { gzip: true, file: backup, cwd: exported }, fs.readdirSync( exported ) );
	fs.rmSync( exported, { recursive: true, force: true } );
	summary.backupBytes = fs.statSync( backup ).size;
	summary.backupSha256 = createHash( 'sha256' ).update( fs.readFileSync( backup ) ).digest( 'hex' );
	saveSummary();
	await cleanup( setup );
	for ( const variant of [ 'trunk', 'draft' ] ) {
		const env = environment( variant, variant );
		try {
			await create( env );
			await stopSite( env, 'stop-before-import' );
			const imported = await cli(
				env,
				'import-and-start',
				[ 'import', backup, '--path', env.site, '--start-server' ],
				900_000
			);
			summary.measurements.push( {
				variant,
				operation: 'post-import-start',
				code: imported.code,
				elapsedMs: imported.elapsedMs,
				startupPhaseMs: imported.startupPhaseMs,
				timedOut: imported.timedOut,
				errorTail: imported.code !== 0 ? imported.stderr.slice( -6000 ) : null,
			} );
			saveSummary();
			if ( imported.code !== 0 ) {
				continue;
			}
			summary.measurements.at( -1 ).verifiedSite = await checkSite( env, 'post-import' );
			for ( let trial = 1; trial <= 3; trial++ ) {
				await stopSite( env, `stop-${ trial }` );
				const started = await cli( env, `start-${ trial }`, [
					'site',
					'start',
					'--path',
					env.site,
					'--skip-browser',
					'--skip-log-details',
				] );
				summary.measurements.push( {
					variant,
					operation: `restart-${ trial }`,
					code: started.code,
					elapsedMs: started.elapsedMs,
					startupPhaseMs: started.startupPhaseMs,
					timedOut: started.timedOut,
					errorTail: started.code !== 0 ? started.stderr.slice( -6000 ) : null,
				} );
				saveSummary();
				if ( started.code !== 0 ) {
					break;
				}
				summary.measurements.at( -1 ).verifiedSite = await checkSite( env, `restart-${ trial }` );
			}
		} catch ( error ) {
			summary.errors.push( { variant, message: String( error ) } );
			process.exitCode = 1;
		} finally {
			await cleanup( env );
			saveSummary();
		}
	}
} catch ( error ) {
	summary.errors.push( { phase: 'fixture', message: String( error ) } );
	process.exitCode = 1;
} finally {
	await cleanup( setup );
	saveSummary();
	fs.rmSync( root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } );
}

console.log( 'STUDIO_STARTUP_PROBE=' + JSON.stringify( summary ) );
