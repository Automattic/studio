/**
 * Reads .buildkite/pipeline.yml the way Buildkite does when CI uploads it, for scripts/ci-local/run.sh.
 *
 *   node pipeline.mjs check <vars file>                        interpolates and checks the pipeline
 *   node pipeline.mjs linux <vars file> <toolkit stubs> [keys] runs the Linux Docker steps locally
 *
 * <vars file> holds the `env` output after sourcing .buildkite/shared-pipeline-vars.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';

const root = path.resolve( import.meta.dirname, '../..' );
const [ command, varsFile, stubs, keys ] = process.argv.slice( 2 );

const vars = Object.fromEntries(
	fs
		.readFileSync( varsFile, 'utf8' )
		.split( '\n' )
		.filter( ( line ) => line.includes( '=' ) )
		.map( ( line ) => [ line.slice( 0, line.indexOf( '=' ) ), line.slice( line.indexOf( '=' ) + 1 ) ] )
);

// Buildkite replaces $VAR and ${VAR} at upload, and turns $$ into a literal $ for the job's shell.
function interpolate( text ) {
	return text
		.split( '$$' )
		.map( ( part ) => part.replace( /\$\{(\w+)\}|\$(\w+)/g, ( _, a, b ) => vars[ a ?? b ] ?? '' ) )
		.join( '$' );
}

const pipeline = parse( interpolate( fs.readFileSync( path.join( root, '.buildkite/pipeline.yml' ), 'utf8' ) ) );

function* commandSteps( steps, group ) {
	for ( const step of steps ?? [] ) {
		if ( step.steps ) {
			yield* commandSteps( step.steps, step );
		} else if ( step.command || step.commands ) {
			yield { step, group };
		}
	}
}

const pluginEntries = ( step ) =>
	( step.plugins ?? [] ).map( ( plugin ) =>
		typeof plugin === 'string' ? [ plugin, {} ] : Object.entries( plugin )[ 0 ]
	);
const dockerConfig = ( step ) =>
	pluginEntries( step ).find( ( [ name ] ) => name.startsWith( 'docker#' ) )?.[ 1 ];
const commandOf = ( step ) => [ step.command ?? step.commands ].flat().join( '\n' );

if ( command === 'check' ) {
	let ok = true;
	const steps = [ ...commandSteps( pipeline.steps ) ];
	for ( const { step } of steps ) {
		for ( const script of commandOf( step ).matchAll( /\.buildkite\/commands\/[\w.-]+/g ) ) {
			if ( ! fs.existsSync( path.join( root, script[ 0 ] ) ) ) {
				console.log( `✖ "${ step.label }" runs ${ script[ 0 ] }, which doesn't exist` );
				ok = false;
			}
		}
		// The cache helpers come from the CI toolkit: a Docker step needs it mounted to call them.
		const docker = dockerConfig( step );
		const usesHelpers = /run-(lint|unit-tests|e2e-tests|cli-e2e-tests)\.sh/.test( commandOf( step ) );
		if ( docker && usesHelpers && ! ( docker.volumes ?? [] ).some( ( v ) => v.includes( '/a8c-ci-toolkit' ) ) ) {
			console.log( `✖ "${ step.label }" runs in Docker without the CI toolkit mounted, so hash_file and the cache helpers are missing` );
			ok = false;
		}
	}
	console.log( `${ steps.length } command steps checked` );
	process.exit( ok ? 0 : 1 );
}

if ( command === 'linux' ) {
	const wanted = keys ? keys.split( ',' ) : [ 'lint', 'unit_tests_linux', 'cli_e2e_tests_linux' ];
	const steps = [ ...commandSteps( pipeline.steps ) ]
		.map( ( { step } ) => step )
		.filter( ( step ) => dockerConfig( step ) && wanted.includes( step.key ) );
	if ( steps.length === 0 ) {
		console.log( `No Docker steps with the keys ${ wanted.join( ', ' ) }` );
		process.exit( 1 );
	}

	// Each job gets a clean copy of the working tree, as CI gets a fresh checkout.
	let ok = true;
	for ( const step of steps ) {
		const docker = dockerConfig( step );
		const shards = step.parallelism ?? 1;
		for ( let shard = 0; shard < shards; shard++ ) {
			const name = shards > 1 ? `${ step.label } (shard ${ shard + 1 }/${ shards })` : step.label;
			console.log( `\n─── ${ name } in ${ docker.image }` );
			const work = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-ci-linux-' ) );
			execFileSync( 'sh', [ '-c', `git ls-files -z -co --exclude-standard | tar --null -T - -cf - | tar -xf - -C "${ work }"` ], {
				cwd: root,
			} );
			const args = [ 'run', '--rm', '-v', `${ work }:/workdir`, '-w', '/workdir' ];
			if ( ( docker.volumes ?? [] ).some( ( v ) => v.includes( '/a8c-ci-toolkit' ) ) ) {
				args.push( '-v', `${ stubs }:/a8c-ci-toolkit/bin:ro` );
			}
			const env = {
				BUILDKITE: 'true',
				BUILDKITE_PIPELINE_SLUG: 'studio',
				BUILDKITE_PULL_REQUEST: '1',
				BUILDKITE_PARALLEL_JOB: String( shard ),
				BUILDKITE_PARALLEL_JOB_COUNT: String( shards ),
				...step.env,
			};
			for ( const [ key, value ] of Object.entries( env ) ) {
				args.push( '-e', `${ key }=${ value }` );
			}
			args.push( docker.image, 'bash', '-eo', 'pipefail', '-c', commandOf( step ) );
			const start = Date.now();
			const result = spawnSync( 'docker', args, { stdio: 'inherit' } );
			try {
				fs.rmSync( work, { recursive: true, force: true } );
			} catch {
				console.log( `(left ${ work }: the container wrote files this user can't delete)` );
			}
			const seconds = Math.round( ( Date.now() - start ) / 1000 );
			console.log( `${ result.status === 0 ? '✔' : '✖' } ${ name } (${ seconds } s)` );
			ok &&= result.status === 0;
		}
	}
	process.exit( ok ? 0 : 1 );
}

console.error( 'Usage: pipeline.mjs check|linux <vars file> [toolkit stubs] [step keys]' );
process.exit( 2 );
