// Whether GitHub's API answered the agent during a case. Unauthenticated, it
// serves 60 requests an hour per IP address, shared by everything on the
// network; once they are spent it answers "API rate limit exceeded". An agent
// that misses that answer (a filter that prints only `tag_name` sees `None`)
// concludes a repository has no releases and builds it from source. A case
// that used GitHub while the API was refusing measures the network, not the
// agent: it is marked invalid, for comparisons to leave out.
import { readFileSync } from 'node:fs';

// The requests left this hour. Reading the limit does not count against it.
async function githubQuota() {
	try {
		const response = await fetch( 'https://api.github.com/rate_limit', {
			headers: { 'User-Agent': 'studio-eval' },
			signal: AbortSignal.timeout( 10000 ),
		} );
		const { resources } = await response.json();
		return { remaining: resources.core.remaining, reset: resources.core.reset };
	} catch ( error ) {
		return { error: error instanceof Error ? error.message : String( error ) };
	}
}

const LOW = 10;

// promptfoo's beforeEach hook: the quota as the case starts, in the test's vars.
export async function beforeEach( { test } ) {
	return { test: { ...test, vars: { ...test.vars, githubQuotaAtStart: await githubQuota() } } };
}

// The assertion: fails, as invalid, a case that used GitHub while the API refused.
export const githubAnswered = async ( output, context ) => {
	const marker = String( output ).match( /EVAL_RUNNER_RESULT_FILE=(\S+)/ );
	if ( ! marker ) return { pass: true, score: 1, reason: 'no runner result' };
	const result = JSON.parse( readFileSync( marker[ 1 ], 'utf8' ) );
	if ( ! /github\.com/.test( JSON.stringify( result.toolCalls || [] ) ) ) {
		return { pass: true, score: 1, reason: 'the agent did not use GitHub' };
	}
	const answers = ( result.toolResults || [] )
		.map( ( toolResult ) => toolResult.text )
		.join( '\n' );
	const start = context.vars.githubQuotaAtStart || {};
	const end = await githubQuota();
	const problems = [];
	if ( typeof start.remaining === 'number' && start.remaining < LOW )
		problems.push( `${ start.remaining } of 60 GitHub API requests left as the case started` );
	if ( end.remaining === 0 ) problems.push( 'no GitHub API requests left as it ended' );
	if ( /API rate limit exceeded/.test( answers ) )
		problems.push( 'GitHub answered the agent "API rate limit exceeded"' );
	const quota = `GitHub API requests left: ${
		start.remaining ?? start.error ?? 'unknown'
	} at start, ${ end.remaining ?? end.error } at end`;
	return problems.length
		? {
				pass: false,
				score: 0,
				reason: `INVALID (environment): ${ problems.join( '; ' ) }. ${ quota }`,
		  }
		: { pass: true, score: 1, reason: quota };
};
