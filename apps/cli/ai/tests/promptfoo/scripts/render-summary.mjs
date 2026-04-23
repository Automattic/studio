import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisDir = path.dirname( fileURLToPath( import.meta.url ) );
const outputPath = path.resolve( thisDir, '..', 'output.json' );

if ( ! fs.existsSync( outputPath ) ) {
	console.log( 'No `output.json` produced — promptfoo likely errored before writing results.' );
	process.exit( 0 );
}

const data = JSON.parse( fs.readFileSync( outputPath, 'utf8' ) );
const results = data.results?.results ?? data.results ?? [];
const total = results.length;
const passed = results.filter( ( r ) => r.success ).length;
const failed = total - passed;

console.log( '# Prompt eval summary' );
console.log( '' );
console.log( `- **Total:** ${ total }` );
console.log( `- **Passed:** ${ passed }` );
console.log( `- **Failed:** ${ failed }` );

if ( failed > 0 ) {
	console.log( '' );
	console.log( '## Failures' );
	for ( const r of results ) {
		if ( r.success ) {
			continue;
		}
		const desc = r.testCase?.description ?? r.description ?? '(no description)';
		console.log( '' );
		console.log( `### ${ desc }` );
		for ( const cr of r.gradingResult?.componentResults ?? [] ) {
			if ( cr.pass ) {
				continue;
			}
			const type = cr.assertion?.type ?? 'assertion';
			const reason = String( cr.reason ?? 'failed' ).split( '\n' )[ 0 ];
			console.log( `- \`${ type }\` — ${ reason }` );
		}
	}
}
