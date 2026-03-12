#!/usr/bin/env node

import fs from 'fs';
import https from 'https';
import path from 'path';
import { getMetricConfig } from '../metrics/metric-config';

interface PerformanceResults {
	[ branch: string ]: {
		[ metric: string ]: number;
	};
}

interface GitHubContext {
	repo: string;
	owner: string;
	prNumber: number;
	token: string;
}

function formatResultsAsMarkdown(
	results: Record< string, PerformanceResults >,
	baseBranch: string,
	compareBranch: string
): string {
	let markdown = `## 📊 Performance Test Results\n\n`;
	markdown += `Comparing **${ compareBranch }** vs **${ baseBranch }**\n\n`;

	for ( const [ testSuite, suiteResults ] of Object.entries( results ) ) {
		markdown += `### ${ testSuite }\n\n`;
		markdown += `| Metric | ${ baseBranch } | ${ compareBranch } | Diff | Change |\n`;
		markdown += `|--------|${ '-'.repeat( baseBranch.length + 2 ) }|${ '-'.repeat(
			compareBranch.length + 2
		) }|------|--------|\n`;

		const baseMetrics = suiteResults[ baseBranch ] || {};
		const compareMetrics = suiteResults[ compareBranch ] || {};

		for ( const metric of Object.keys( { ...baseMetrics, ...compareMetrics } ) ) {
			const { label, format, threshold } = getMetricConfig( metric );
			const baseValue = baseMetrics[ metric ] || 0;
			const compareValue = compareMetrics[ metric ] || 0;
			const diff = compareValue - baseValue;
			const isNoChange = Math.abs( diff ) < threshold;
			let percentChange = 'N/A';
			if ( isNoChange ) {
				percentChange = '0.0';
			} else if ( baseValue !== 0 ) {
				percentChange = ( ( diff / baseValue ) * 100 ).toFixed( 1 );
			}

			let emoji = '⚪';
			if ( ! isNoChange ) {
				if ( diff > 0 ) {
					emoji = '🔴';
				} else if ( diff < 0 ) {
					emoji = '🟢';
				}
			}
			const sign = diff > 0 ? '+' : '';
			const diffFormatted = `${ sign }${ format( Math.abs( diff ) ) }`;

			markdown += `| ${ label } | ${ format( baseValue ) } | ${ format(
				compareValue
			) } | ${ diffFormatted } | ${ emoji } ${ percentChange }% |\n`;
		}

		markdown += `\n`;
	}

	markdown += `\n---\n`;
	markdown += `*Results are median values from multiple test runs.*\n\n`;
	markdown += `*Legend: 🟢 Improvement (faster) | 🔴 Regression (slower) | ⚪ No change (<50ms diff)*\n`;

	return markdown;
}

async function findOrCreateComment(
	context: GitHubContext,
	commentIdentifier: string
): Promise< number | null > {
	return new Promise( ( resolve, reject ) => {
		const options = {
			hostname: 'api.github.com',
			port: 443,
			path: `/repos/${ context.owner }/${ context.repo }/issues/${ context.prNumber }/comments`,
			method: 'GET',
			headers: {
				Accept: 'application/vnd.github.v3+json',
				Authorization: `token ${ context.token }`,
				'User-Agent': 'studio-performance-bot',
			},
		};

		const req = https.request( options, ( res ) => {
			let data = '';
			res.on( 'data', ( chunk ) => ( data += chunk ) );
			res.on( 'end', () => {
				if ( res.statusCode === 200 ) {
					const comments = JSON.parse( data );
					const existingComment = comments.find(
						( c: { body?: string } ) => c.body?.includes( commentIdentifier )
					);
					resolve( existingComment?.id || null );
				} else {
					reject( new Error( `Failed to fetch comments: ${ res.statusCode }` ) );
				}
			} );
		} );

		req.on( 'error', reject );
		req.end();
	} );
}

async function postOrUpdateComment( context: GitHubContext, body: string ): Promise< void > {
	const commentIdentifier = '<!-- performance-test-results -->';
	const bodyWithIdentifier = `${ commentIdentifier }\n${ body }`;

	const existingCommentId = await findOrCreateComment( context, commentIdentifier );

	const method = existingCommentId ? 'PATCH' : 'POST';
	const apiPath = existingCommentId
		? `/repos/${ context.owner }/${ context.repo }/issues/comments/${ existingCommentId }`
		: `/repos/${ context.owner }/${ context.repo }/issues/${ context.prNumber }/comments`;

	return new Promise( ( resolve, reject ) => {
		const postData = JSON.stringify( { body: bodyWithIdentifier } );

		const options = {
			hostname: 'api.github.com',
			port: 443,
			path: apiPath,
			method,
			headers: {
				Accept: 'application/vnd.github.v3+json',
				Authorization: `token ${ context.token }`,
				'User-Agent': 'studio-performance-bot',
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength( postData ),
			},
		};

		const req = https.request( options, ( res ) => {
			let data = '';
			res.on( 'data', ( chunk ) => ( data += chunk ) );
			res.on( 'end', () => {
				if ( res.statusCode === 200 || res.statusCode === 201 ) {
					console.log( `✅ Successfully ${ existingCommentId ? 'updated' : 'posted' } PR comment` );
					resolve();
				} else {
					reject( new Error( `Failed to post comment: ${ res.statusCode } ${ data }` ) );
				}
			} );
		} );

		req.on( 'error', reject );
		req.write( postData );
		req.end();
	} );
}

async function main() {
	const [ token, repo, prNumber, baseBranch, compareBranch, artifactsPath ] =
		process.argv.slice( 2 );

	if ( ! token || ! repo || ! prNumber || ! baseBranch || ! compareBranch ) {
		console.error(
			'Usage: post-to-github <token> <repo> <pr-number> <base-branch> <compare-branch> [artifacts-path]'
		);
		process.exit( 1 );
	}

	const [ owner, repoName ] = repo.split( '/' );
	const context: GitHubContext = {
		repo: repoName,
		owner,
		prNumber: parseInt( prNumber, 10 ),
		token,
	};

	const resultsPath = artifactsPath || process.env.ARTIFACTS_PATH || 'artifacts';
	const summaryFiles = fs
		.readdirSync( resultsPath )
		.filter( ( f ) => f.endsWith( '.summary.json' ) );

	if ( summaryFiles.length === 0 ) {
		console.error( `No summary files found in ${ resultsPath }` );
		process.exit( 1 );
	}

	const results: Record< string, PerformanceResults > = {};
	for ( const file of summaryFiles ) {
		const testSuite = file.replace( '.summary.json', '' );
		const filePath = path.join( resultsPath, file );
		results[ testSuite ] = JSON.parse( fs.readFileSync( filePath, 'utf8' ) );
	}

	const markdown = formatResultsAsMarkdown( results, baseBranch, compareBranch );
	await postOrUpdateComment( context, markdown );
}

main().catch( ( error ) => {
	console.error( 'Error posting to GitHub:', error );
	process.exit( 1 );
} );
