/**
 * Git operations for the WordPress Contributor Toolkit addon.
 * Uses isomorphic-git with Node.js fs adapter.
 */
import * as fs from 'node:fs';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import type { CloneProgress, PatchResult } from '../types';

const WP_DEVELOP_URL = 'https://github.com/WordPress/wordpress-develop.git';

export async function cloneWordPressDevelop(
	targetPath: string,
	onProgress: ( progress: CloneProgress ) => void
): Promise< void > {
	await git.clone( {
		fs,
		http,
		dir: targetPath,
		url: WP_DEVELOP_URL,
		depth: 1,
		singleBranch: true,
		ref: 'trunk',
		onProgress: ( { phase, loaded, total } ) => {
			onProgress( { phase, loaded: loaded ?? 0, total: total ?? 0 } );
		},
	} );
}

export async function getChangedFiles( repoPath: string ): Promise< string[] > {
	const matrix = await git.statusMatrix( { fs, dir: repoPath } );
	// statusMatrix returns [filepath, HEAD, WORKDIR, STAGE]
	// Filter out files that are unchanged (1, 1, 1)
	return matrix
		.filter( ( [ , head, workdir ] ) => head !== 1 || workdir !== 1 )
		.map( ( [ filepath ] ) => filepath );
}

export async function generateUnifiedPatch(
	repoPath: string,
	outputPath: string
): Promise< PatchResult > {
	try {
		const matrix = await git.statusMatrix( { fs, dir: repoPath } );
		const changedFiles = matrix.filter( ( [ , head, workdir ] ) => head !== 1 || workdir !== 1 );

		if ( changedFiles.length === 0 ) {
			return { success: false, error: 'No changed files to generate patch from.' };
		}

		const patches: string[] = [];

		for ( const [ filepath, head, workdir ] of changedFiles ) {
			const fullPath = `${ repoPath }/${ filepath }`;

			let oldContent = '';
			let newContent = '';

			// Get original content from HEAD if file existed
			if ( head === 1 ) {
				const commitSha = await git.resolveRef( { fs, dir: repoPath, ref: 'HEAD' } );
				const { blob } = await git.readBlob( {
					fs,
					dir: repoPath,
					oid: commitSha,
					filepath,
				} );
				oldContent = Buffer.from( blob ).toString( 'utf8' );
			}

			// Get working directory content if file exists
			if ( workdir === 1 || workdir === 2 ) {
				try {
					newContent = fs.readFileSync( fullPath, 'utf8' );
				} catch {
					// File deleted
					newContent = '';
				}
			}

			const patch = buildUnifiedDiff( filepath, oldContent, newContent );
			if ( patch ) {
				patches.push( patch );
			}
		}

		if ( patches.length === 0 ) {
			return { success: false, error: 'Could not generate diff for changed files.' };
		}

		const fullPatch = patches.join( '\n' );
		fs.writeFileSync( outputPath, fullPatch, 'utf8' );

		return { success: true, patchPath: outputPath };
	} catch ( error ) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String( error ),
		};
	}
}

function buildUnifiedDiff( filepath: string, oldContent: string, newContent: string ): string {
	const oldLines = oldContent ? oldContent.split( '\n' ) : [];
	const newLines = newContent ? newContent.split( '\n' ) : [];

	// Simple line-based diff using LCS
	const diffLines = computeDiff( oldLines, newLines );

	if ( diffLines.length === 0 ) {
		return '';
	}

	const header = [ `--- a/${ filepath }`, `+++ b/${ filepath }` ];

	return [ ...header, ...diffLines ].join( '\n' ) + '\n';
}

function computeDiff( oldLines: string[], newLines: string[] ): string[] {
	// Build LCS table
	const m = oldLines.length;
	const n = newLines.length;
	const lcs: number[][] = Array.from( { length: m + 1 }, () => new Array( n + 1 ).fill( 0 ) );

	for ( let i = 1; i <= m; i++ ) {
		for ( let j = 1; j <= n; j++ ) {
			if ( oldLines[ i - 1 ] === newLines[ j - 1 ] ) {
				lcs[ i ][ j ] = lcs[ i - 1 ][ j - 1 ] + 1;
			} else {
				lcs[ i ][ j ] = Math.max( lcs[ i - 1 ][ j ], lcs[ i ][ j - 1 ] );
			}
		}
	}

	// Backtrack to get diff
	const diff: Array< { type: '+' | '-' | ' '; line: string; oldLine: number; newLine: number } > =
		[];
	let i = m;
	let j = n;

	while ( i > 0 || j > 0 ) {
		if ( i > 0 && j > 0 && oldLines[ i - 1 ] === newLines[ j - 1 ] ) {
			diff.unshift( { type: ' ', line: oldLines[ i - 1 ], oldLine: i, newLine: j } );
			i--;
			j--;
		} else if ( j > 0 && ( i === 0 || lcs[ i ][ j - 1 ] >= lcs[ i - 1 ][ j ] ) ) {
			diff.unshift( { type: '+', line: newLines[ j - 1 ], oldLine: i, newLine: j } );
			j--;
		} else {
			diff.unshift( { type: '-', line: oldLines[ i - 1 ], oldLine: i, newLine: j } );
			i--;
		}
	}

	// Group into hunks with context
	const CONTEXT = 3;
	const hunks: string[] = [];
	let currentHunk: string[] | null = null;
	let hunkOldStart = 0;
	let hunkNewStart = 0;
	let hunkOldCount = 0;
	let hunkNewCount = 0;
	let contextBuffer: string[] = [];

	const flushHunk = () => {
		if ( currentHunk && currentHunk.length > 0 ) {
			const header = `@@ -${ hunkOldStart },${ hunkOldCount } +${ hunkNewStart },${ hunkNewCount } @@`;
			hunks.push( header, ...currentHunk );
		}
		currentHunk = null;
	};

	for ( let idx = 0; idx < diff.length; idx++ ) {
		const entry = diff[ idx ];

		if ( entry.type === ' ' ) {
			if ( currentHunk ) {
				currentHunk.push( ` ${ entry.line }` );
				hunkOldCount++;
				hunkNewCount++;
				contextBuffer.push( ` ${ entry.line }` );
				if ( contextBuffer.length > CONTEXT * 2 ) {
					// Check if there's another change soon
					const nextChange = diff
						.slice( idx + 1, idx + CONTEXT + 1 )
						.some( ( e ) => e.type !== ' ' );
					if ( ! nextChange ) {
						// Trim trailing context and flush
						const trimmedContext = contextBuffer.slice( -CONTEXT );
						hunkOldCount -= contextBuffer.length - trimmedContext.length;
						hunkNewCount -= contextBuffer.length - trimmedContext.length;
						flushHunk();
						contextBuffer = [];
					}
				}
			} else {
				contextBuffer.push( ` ${ entry.line }` );
				if ( contextBuffer.length > CONTEXT ) {
					contextBuffer.shift();
				}
			}
		} else {
			if ( ! currentHunk ) {
				currentHunk = [ ...contextBuffer ];
				hunkOldStart =
					entry.type === '-'
						? entry.oldLine - contextBuffer.length
						: entry.oldLine - contextBuffer.length;
				hunkNewStart =
					entry.type === '+'
						? entry.newLine - contextBuffer.length
						: entry.newLine - contextBuffer.length;
				hunkOldCount = contextBuffer.length;
				hunkNewCount = contextBuffer.length;
				contextBuffer = [];
			}

			if ( entry.type === '-' ) {
				currentHunk.push( `-${ entry.line }` );
				hunkOldCount++;
			} else {
				currentHunk.push( `+${ entry.line }` );
				hunkNewCount++;
			}
			contextBuffer = [];
		}
	}

	// Add trailing context
	if ( currentHunk && contextBuffer.length > 0 ) {
		const trailing = contextBuffer.slice( 0, CONTEXT );
		currentHunk.push( ...trailing );
		hunkOldCount += trailing.length;
		hunkNewCount += trailing.length;
	}

	flushHunk();

	return hunks;
}
