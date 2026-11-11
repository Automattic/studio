#!/usr/bin/env node

/**
 * The deterministic half of the docs refresh (.buildkite/docs-refresh.yml): what changed in
 * Studio, what the agent is told, and what its work has to pass before a pull request opens.
 *
 *   docs-refresh.mjs brief   --out <dir> [--version <x.y.z>] [--since <ref>] [--capture <results.json>]…
 *   docs-refresh.mjs desktop-shots --shots <dir>
 *   docs-refresh.mjs verify  [--baseline <file>]
 *   docs-refresh.mjs open-pr --repo <owner/name> --head <branch> --base <branch> --title <title> --out <dir>
 *
 * `brief` prints `run` or `skip` on stdout; the brief itself goes to <dir>/brief.md.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..', '..' );
const DOCS_ROOT = 'docs/user';
const PAGES_DIR = `${ DOCS_ROOT }/docs`;
// The code a user can see change. Everything else (tests, CI, tooling) never needs a docs page.
const PRODUCT_PATHS = [ 'apps', 'packages' ];
const DEPENDENCY_UPDATE = /^(build\(deps|bump )/i;

/**
 * The lines under a version's heading in RELEASE-NOTES.txt, whose headings are a title
 * underlined with `=`.
 */
export function extractReleaseNotes( text, version ) {
	const lines = text.split( '\n' );
	const isHeading = ( index ) => /^=+\s*$/.test( lines[ index + 1 ] ?? '' );
	const start = lines.findIndex( ( line, index ) => line.trim() === version && isHeading( index ) );
	if ( start === -1 ) {
		return null;
	}
	const section = [];
	for ( let index = start + 2; index < lines.length && ! isHeading( index ); index++ ) {
		section.push( lines[ index ] );
	}
	return section.join( '\n' ).trim();
}

/**
 * One change per line, from release notes (`* Title #123`) or squash-merge subjects
 * (`Title (#123)`). Dependency updates are counted but left out.
 */
export function parseChanges( text ) {
	const changes = [];
	let dependencyUpdates = 0;
	for ( const raw of text.split( '\n' ) ) {
		const line = raw.replace( /^\*\s+/, '' ).trim();
		if ( ! line || line.startsWith( '<!--' ) || /^Merge (branch|remote-tracking) /.test( line ) ) {
			continue;
		}
		if ( DEPENDENCY_UPDATE.test( line ) ) {
			dependencyUpdates++;
			continue;
		}
		const match = line.match( /^(.*?)\s*\(?#(\d+)\)?$/ );
		changes.push( match ? { title: match[ 1 ], pr: Number( match[ 2 ] ) } : { title: line } );
	}
	return { changes, dependencyUpdates };
}

/**
 * Several `studio-capture check --json` results as one: a later result's shots replace the
 * same shots of an earlier one, as the Studio Desktop pass does for the shots the browser skipped.
 */
export function mergeCaptures( results ) {
	const shots = new Map();
	for ( const result of results ) {
		for ( const shot of result?.shots ?? [] ) {
			shots.set( `${ shot.script }/${ shot.name }`, shot );
		}
	}
	return {
		studioVersion: results.find( ( result ) => result?.studioVersion )?.studioVersion ?? null,
		shots: [ ...shots.values() ],
	};
}

/**
 * The names of the shots only Studio Desktop can capture (`desktopOnly`), from parsed shot scripts.
 */
export function findDesktopShots( scripts ) {
	return scripts.flatMap( ( script ) =>
		( script.shots ?? [] )
			.filter( ( shot ) => shot.desktopOnly && shot.name )
			.map( ( shot ) => shot.name )
	);
}

// The harness reports absolute paths; the brief is read in other checkouts.
function fromRepoRoot( file ) {
	return file && path.isAbsolute( file ) ? path.relative( REPO_ROOT, file ) : file;
}

/**
 * What `studio-capture check --json` found, reduced to the shots that need a look.
 */
export function summarizeCapture( result ) {
	const summary = {
		studioVersion: result?.studioVersion ?? null,
		changed: [],
		added: [],
		failed: [],
		notRun: [],
	};
	for ( const shot of result?.shots ?? [] ) {
		if ( shot.status === 'failed' ) {
			summary.failed.push( { name: shot.name, script: shot.script, error: shot.error } );
			continue;
		}
		if ( shot.status === 'notRun' ) {
			summary.notRun.push( { name: shot.name, script: shot.script } );
			continue;
		}
		for ( const file of shot.files ?? [] ) {
			const entry = { name: shot.name, script: shot.script, file: fromRepoRoot( file.file ) };
			if ( file.status === 'changed' ) {
				summary.changed.push( {
					...entry,
					diffPixels: file.diffPixels,
					diff: fromRepoRoot( file.diff ),
				} );
			} else if ( file.status === 'new' ) {
				summary.added.push( entry );
			}
		}
	}
	return summary;
}

export function shouldRun( { changes, capture, instruction } ) {
	return Boolean(
		instruction ||
			changes.length ||
			capture.changed.length ||
			capture.added.length ||
			capture.failed.length ||
			capture.notRun?.length
	);
}

export function buildBrief( { target, source, changes, dependencyUpdates, capture, instruction } ) {
	const lines = [ `# Docs refresh brief: ${ target }`, '' ];
	if ( instruction ) {
		lines.push( '## Instruction from whoever started this run', '', instruction, '' );
	}
	lines.push( `## Changes to review (${ source })`, '' );
	if ( changes.length ) {
		lines.push( ...changes.map( ( { title, pr } ) => `- ${ title }${ pr ? ` (#${ pr })` : '' }` ) );
	} else {
		lines.push( 'None.' );
	}
	if ( dependencyUpdates ) {
		lines.push( '', `${ dependencyUpdates } dependency update(s) left out.` );
	}
	lines.push(
		'',
		`## Screenshot check${ capture.studioVersion ? ` (Studio ${ capture.studioVersion })` : '' }`,
		''
	);
	if ( ! capture.changed.length && ! capture.added.length && ! capture.failed.length ) {
		lines.push( 'Every shot matches the committed image.' );
	}
	if ( capture.failed.length ) {
		lines.push(
			'### Failed: the script no longer reaches the screen',
			'',
			...capture.failed.map(
				( shot ) => `- \`${ shot.name }\` (${ shot.script }): ${ shot.error ?? 'no error given' }`
			),
			''
		);
	}
	if ( capture.notRun?.length ) {
		lines.push(
			'### Not run: an earlier shot of the same script failed',
			'',
			'A script’s shots build on each other, so these were never checked. Repair the failed shot, then run the script again: they may need repairs too.',
			'',
			...capture.notRun.map( ( shot ) => `- \`${ shot.name }\` (${ shot.script })` ),
			''
		);
	}
	if ( capture.changed.length ) {
		lines.push(
			'### Changed: the app no longer looks like the committed image',
			'',
			...capture.changed.map(
				( shot ) =>
					`- \`${ shot.file }\` (${ shot.script }): ${
						shot.diffPixels === undefined
							? 'the image changed size'
							: `${ shot.diffPixels } pixels differ`
					}${ shot.diff ? `, differences in \`${ shot.diff }\`` : '' }`
			),
			''
		);
	}
	if ( capture.added.length ) {
		lines.push(
			'### New: no committed image yet',
			'',
			...capture.added.map( ( shot ) => `- \`${ shot.file }\` (${ shot.script })` ),
			''
		);
	}
	return lines.join( '\n' ).trimEnd() + '\n';
}

/**
 * The paths of `git status --porcelain` output, with a rename counted at both ends.
 */
export function parseStatusPaths( porcelain ) {
	return porcelain
		.split( '\n' )
		.filter( Boolean )
		.flatMap( ( line ) => line.slice( 3 ).split( ' -> ' ) )
		.map( ( file ) => file.replace( /^"|"$/g, '' ) );
}

/**
 * Changed paths outside the docs folder, ignoring those that were already dirty before the agent ran.
 */
export function findOutOfScope( paths, baseline = [] ) {
	const before = new Set( baseline );
	return paths.filter( ( file ) => ! file.startsWith( `${ DOCS_ROOT }/` ) && ! before.has( file ) );
}

/**
 * The relative image paths a Markdown page shows.
 */
export function findImageLinks( markdown ) {
	return [ ...markdown.matchAll( /!\[[^\]]*\]\(\s*([^)\s]+)/g ) ]
		.map( ( match ) => match[ 1 ] )
		.filter( ( link ) => ! /^[a-z]+:/i.test( link ) );
}

function listMarkdown( dir ) {
	return readdirSync( dir, { withFileTypes: true } ).flatMap( ( entry ) => {
		const file = path.join( dir, entry.name );
		if ( entry.isDirectory() ) {
			return listMarkdown( file );
		}
		return entry.name.endsWith( '.md' ) ? [ file ] : [];
	} );
}

function findMissingImages( root ) {
	const missing = [];
	for ( const page of listMarkdown( path.join( root, PAGES_DIR ) ) ) {
		for ( const link of findImageLinks( readFileSync( page, 'utf8' ) ) ) {
			if ( ! existsSync( path.resolve( path.dirname( page ), link ) ) ) {
				missing.push( `${ path.relative( root, page ) }: ${ link }` );
			}
		}
	}
	return missing;
}

export function buildPullRequestBody( { target, summary, capture, buildUrl } ) {
	const shots = [
		...capture.changed.map( ( shot ) => `- \`${ shot.file }\`: changed` ),
		...capture.added.map( ( shot ) => `- \`${ shot.file }\`: new` ),
		...capture.failed.map( ( shot ) => `- \`${ shot.name }\`: failed before the refresh` ),
	];
	return [
		'## Related issues',
		'',
		`- Docs refresh for ${ target }${ buildUrl ? `, from [this build](${ buildUrl })` : '' }`,
		'',
		'## How AI was used in this PR',
		'',
		'An agent wrote this change unattended, from the list of changes and the screenshot check in the build above. Nobody has reviewed the text or looked at the images yet.',
		'',
		'## Proposed Changes',
		'',
		summary.trim() || 'The agent left no summary.',
		'',
		'## Testing Instructions',
		'',
		'- Read each changed page against the app.',
		'- Look at every changed image: the right screen, nothing cut off, no real account data.',
		...( shots.length ? [ '', 'Shots the check flagged before the refresh:', '', ...shots ] : [] ),
		'',
		'## Pre-merge Checklist',
		'',
		'- [ ] A person has read the changed pages and looked at the changed images',
		'',
	].join( '\n' );
}

function git( args ) {
	return execFileSync( 'git', args, { cwd: REPO_ROOT, encoding: 'utf8' } ).trim();
}

function option( args, name ) {
	const index = args.indexOf( `--${ name }` );
	return index === -1 ? undefined : args[ index + 1 ];
}

function options( args, name ) {
	return args.flatMap( ( arg, index ) => ( arg === `--${ name }` ? [ args[ index + 1 ] ] : [] ) );
}

function readCapture( files ) {
	return summarizeCapture(
		mergeCaptures(
			files
				.filter( ( file ) => file && existsSync( file ) )
				.map( ( file ) => JSON.parse( readFileSync( file, 'utf8' ) ) )
		)
	);
}

function runDesktopShots( args ) {
	const dir = path.resolve( option( args, 'shots' ) );
	const scripts = readdirSync( dir )
		.filter( ( file ) => file.endsWith( '.json' ) )
		.sort()
		.map( ( file ) => JSON.parse( readFileSync( path.join( dir, file ), 'utf8' ) ) );
	console.log( findDesktopShots( scripts ).join( ',' ) );
}

function collectChanges( { version, since } ) {
	if ( version ) {
		const notes = extractReleaseNotes(
			readFileSync( path.join( REPO_ROOT, 'RELEASE-NOTES.txt' ), 'utf8' ),
			version
		);
		if ( notes === null ) {
			throw new Error( `RELEASE-NOTES.txt has no section for ${ version }` );
		}
		return { source: `release notes for ${ version }`, ...parseChanges( notes ) };
	}
	// Without a version, review what merged since the docs last changed: a refresh that
	// changes nothing looks at the same commits again next time, and one that merges moves on.
	const from = since ?? git( [ 'log', '-1', '--no-merges', '--format=%H', '--', PAGES_DIR ] );
	const subjects = git( [
		'log',
		'--no-merges',
		'--reverse',
		'--format=%s',
		`${ from }..HEAD`,
		'--',
		...PRODUCT_PATHS,
	] );
	return { source: `merged since ${ from.slice( 0, 9 ) }`, ...parseChanges( subjects ) };
}

function runBrief( args ) {
	const out = option( args, 'out' );
	const version = option( args, 'version' );
	const instruction = ( process.env.DOCS_REFRESH_PROMPT ?? '' ).trim();
	const capture = readCapture( options( args, 'capture' ) );
	const { source, changes, dependencyUpdates } = collectChanges( {
		version,
		since: option( args, 'since' ),
	} );
	mkdirSync( out, { recursive: true } );
	writeFileSync(
		path.join( out, 'brief.md' ),
		buildBrief( {
			target: version ?? 'trunk',
			source,
			changes,
			dependencyUpdates,
			capture,
			instruction,
		} )
	);
	writeFileSync( path.join( out, 'capture-summary.json' ), JSON.stringify( capture, null, '\t' ) );
	console.log( shouldRun( { changes, capture, instruction } ) ? 'run' : 'skip' );
}

function runVerify( args ) {
	const baselineFile = option( args, 'baseline' );
	const baseline = baselineFile ? parseStatusPaths( readFileSync( baselineFile, 'utf8' ) ) : [];
	const status = execFileSync( 'git', [ 'status', '--porcelain', '--untracked-files=all' ], {
		cwd: REPO_ROOT,
		encoding: 'utf8',
	} );
	const problems = [
		...findOutOfScope( parseStatusPaths( status ), baseline ).map(
			( file ) => `Changed outside ${ DOCS_ROOT }/: ${ file }`
		),
		...findMissingImages( REPO_ROOT ).map( ( link ) => `Image not found: ${ link }` ),
	];
	if ( problems.length ) {
		console.error( problems.join( '\n' ) );
		process.exit( 1 );
	}
}

async function github( route, { method = 'GET', body } = {} ) {
	const response = await fetch( `https://api.github.com${ route }`, {
		method,
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${ process.env.GITHUB_TOKEN }`,
			'User-Agent': 'studio-docs-refresh',
		},
		body: body ? JSON.stringify( body ) : undefined,
	} );
	if ( ! response.ok ) {
		throw new Error(
			`GitHub ${ method } ${ route }: ${ response.status } ${ await response.text() }`
		);
	}
	return response.json();
}

async function runOpenPr( args ) {
	const repo = option( args, 'repo' );
	const head = option( args, 'head' );
	const out = option( args, 'out' );
	const summaryFile = path.join( out, 'summary.md' );
	const body = buildPullRequestBody( {
		target: option( args, 'target' ) ?? head,
		summary: existsSync( summaryFile ) ? readFileSync( summaryFile, 'utf8' ) : '',
		capture: readCapture( path.join( out, 'capture.json' ) ),
		buildUrl: process.env.BUILDKITE_BUILD_URL,
	} );
	const [ owner ] = repo.split( '/' );
	const open = await github(
		`/repos/${ repo }/pulls?state=open&head=${ owner }:${ encodeURIComponent( head ) }`
	);
	// One pull request per target: a later run adds commits to it and rewrites its description.
	const pull = open.length
		? await github( `/repos/${ repo }/pulls/${ open[ 0 ].number }`, {
				method: 'PATCH',
				body: { body },
		  } )
		: await github( `/repos/${ repo }/pulls`, {
				method: 'POST',
				body: { title: option( args, 'title' ), head, base: option( args, 'base' ), body },
		  } );
	console.log( pull.html_url );
}

if ( process.argv[ 1 ] && path.resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {
	const [ command, ...args ] = process.argv.slice( 2 );
	const commands = {
		brief: runBrief,
		'desktop-shots': runDesktopShots,
		verify: runVerify,
		'open-pr': runOpenPr,
	};
	if ( ! commands[ command ] ) {
		console.error( 'Usage: docs-refresh.mjs brief|desktop-shots|verify|open-pr [options]' );
		process.exit( 2 );
	}
	await commands[ command ]( args );
}
