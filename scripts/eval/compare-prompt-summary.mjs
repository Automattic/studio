// Summarize a compare-prompt run: node compare-prompt-summary.mjs results.json
import { readFileSync, existsSync } from 'node:fs';

const results = JSON.parse( readFileSync( process.argv[ 2 ], 'utf8' ) ).results.results;
const rows = new Map();
for ( const r of results ) {
	const arm = r.provider?.label ?? r.provider?.id;
	const test = r.testCase?.description ?? r.description;
	const key = `${ test }\u0000${ arm }`;
	const row = rows.get( key ) ?? {
		test,
		arm,
		runs: 0,
		pass: 0,
		cost: 0,
		tokens: 0,
		ms: 0,
		turns: 0,
		coreReads: 0,
	};
	row.runs++;
	if ( r.success ) row.pass++;
	const marker = String( r.response?.output ?? '' ).match( /EVAL_RUNNER_RESULT_FILE=(\S+)/ );
	if ( marker && existsSync( marker[ 1 ] ) ) {
		const d = JSON.parse( readFileSync( marker[ 1 ], 'utf8' ) );
		row.cost += d.usage?.costUsd ?? 0;
		row.tokens += d.usage?.totalTokens ?? 0;
		row.ms += d.phaseTimingsMs?.total_eval_ms ?? 0;
		row.turns += d.numTurns ?? 0;
		row.coreReads += ( d.toolCalls ?? [] ).filter(
			( c ) =>
				[ 'Read', 'Grep', 'Glob', 'Ls', 'Bash' ].includes( c.name ) &&
				/wp-includes|wp-admin/.test( JSON.stringify( c.input ) )
		).length;
	}
	rows.set( key, row );
}
const avg = ( v, n ) => ( n ? v / n : 0 );
console.log(
	'| Case | Arm | Pass | Avg cost | Avg tokens | Avg wall | Avg turns | Core reads/run |'
);
console.log( '|---|---|---|---|---|---|---|---|' );
const totals = {};
for ( const r of [ ...rows.values() ].sort(
	( a, b ) => a.test.localeCompare( b.test ) || a.arm.localeCompare( b.arm )
) ) {
	console.log(
		`| ${ r.test } | ${ r.arm } | ${ r.pass }/${ r.runs } | $${ avg( r.cost, r.runs ).toFixed(
			3
		) } | ${ Math.round( avg( r.tokens, r.runs ) ) } | ${ ( avg( r.ms, r.runs ) / 1000 ).toFixed(
			0
		) }s | ${ avg( r.turns, r.runs ).toFixed( 1 ) } | ${ avg( r.coreReads, r.runs ).toFixed(
			1
		) } |`
	);
	const t = ( totals[ r.arm ] ??= { runs: 0, pass: 0, cost: 0, tokens: 0, ms: 0 } );
	for ( const k of [ 'runs', 'pass', 'cost', 'tokens', 'ms' ] ) t[ k ] += r[ k ];
}
console.log( '\n| Arm | Pass | Total cost | Total tokens | Total wall |\n|---|---|---|---|---|' );
for ( const [ arm, t ] of Object.entries( totals ) ) {
	console.log(
		`| ${ arm } | ${ t.pass }/${ t.runs } | $${ t.cost.toFixed( 2 ) } | ${ t.tokens } | ${ (
			t.ms / 60000
		).toFixed( 0 ) }m |`
	);
}
