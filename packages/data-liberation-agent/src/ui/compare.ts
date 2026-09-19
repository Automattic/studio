// src/ui/compare.ts
//
// `data-liberation compare <dir>`: browser-compare the liberated copy to its
// source at widths capture never sampled. `--screenshots` writes PNG evidence
// and never decides pass/fail.
//
import { checkFidelity, type FidelityReport } from '../lib/fidelity/check.js';
import { summariseFindings } from '../lib/fidelity/self-consistency.js';

export async function runCompare(
	directory: string,
	options: { screenshots?: boolean } = {}
): Promise< FidelityReport > {
	const report = await checkFidelity( {
		directory,
		screenshots: options.screenshots,
		log: ( message ) => process.stderr.write( `${ message }\n` ),
	} );

	// Tier one, over every route.
	const consistency = report.selfConsistency;
	if ( consistency.pass ) {
		process.stdout.write( `self-consistency ok across ${ consistency.routes } route(s)\n` );
	} else {
		for ( const group of summariseFindings( consistency.findings ) ) {
			process.stdout.write(
				`self-consistency FAIL ${ group.kind }: ${ group.routes } route(s) — ${ group.examples.join(
					'; '
				) }\n`
			);
		}
	}

	// Tier two, over the sampled routes.
	for ( const score of report.scores ) {
		const mark = score.pass ? 'ok' : 'FAIL';
		process.stdout.write( `${ score.route } ${ score.viewport }px ${ mark }` );
		if ( ! score.pass ) process.stdout.write( `: ${ score.failures.join( '; ' ) }` );
		if ( score.notes.length ) process.stdout.write( `  (${ score.notes.join( '; ' ) })` );
		process.stdout.write( '\n' );
	}

	// Say what was measured, not just how it went. "Passed" over an unstated
	// scope is how a sampled check gets read as a whole-site result.
	const scope = `${ consistency.routes } route(s) checked offline, ${ report.routes.length } of ${ report.routesAvailable } compared to source`;
	process.stdout.write(
		report.pass
			? `Passed: ${ scope }, against ${ report.sourceUrl }\n`
			: `Failed ${ report.failed } source check(s) and ${ consistency.findings.length } offline finding(s): ${ scope }, against ${ report.sourceUrl }\n`
	);
	return report;
}
