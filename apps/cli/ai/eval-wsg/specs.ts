import fs from 'fs';
import path from 'path';

/**
 * Eval spec format. A spec file pairs a site description (the same JSON the
 * generation tools take) with optional expectations the scorecard checks
 * against. Specs live in `eval/wsg/specs/*.json` at the repo root.
 */

// The site spec object passed verbatim to every generation tool. Intentionally
// loose — the tools normalise it — but these are the fields that drive quality.
export interface WsgSiteSpec {
	name: string;
	type?: string;
	audience?: string;
	tone?: string;
	topic?: string;
	layoutPreference?: string;
	pages?: string[];
	features?: string[];
	[ key: string ]: unknown;
}

export interface WsgExpectations {
	needsCompanionPlugin?: boolean;
	minPages?: number;
	minCustomBlocks?: number;
	inputCptsNeedBlock?: boolean;
}

export interface EvalSpec {
	caseId: string;
	spec: WsgSiteSpec;
	expects?: WsgExpectations;
}

export function parseSpec( raw: unknown, sourceLabel: string ): EvalSpec {
	if ( ! raw || typeof raw !== 'object' ) {
		throw new Error( `Spec ${ sourceLabel } is not a JSON object.` );
	}
	const obj = raw as Record< string, unknown >;
	const caseId = typeof obj.caseId === 'string' ? obj.caseId.trim() : '';
	if ( ! caseId ) {
		throw new Error( `Spec ${ sourceLabel } is missing a non-empty "caseId".` );
	}
	if ( ! obj.spec || typeof obj.spec !== 'object' ) {
		throw new Error( `Spec ${ sourceLabel } is missing a "spec" object.` );
	}
	const spec = obj.spec as WsgSiteSpec;
	if ( typeof spec.name !== 'string' || ! spec.name.trim() ) {
		throw new Error( `Spec ${ sourceLabel } "spec.name" must be a non-empty string.` );
	}
	const expects =
		obj.expects && typeof obj.expects === 'object' ? ( obj.expects as WsgExpectations ) : undefined;
	return { caseId, spec, expects };
}

export function loadSpecs( specsDir: string, only?: string[] ): EvalSpec[] {
	if ( ! fs.existsSync( specsDir ) ) {
		throw new Error( `Specs directory not found: ${ specsDir }` );
	}
	const files = fs
		.readdirSync( specsDir )
		.filter( ( f ) => f.endsWith( '.json' ) )
		.sort();
	const specs: EvalSpec[] = [];
	const seen = new Set< string >();
	for ( const file of files ) {
		const full = path.join( specsDir, file );
		const parsed = parseSpec( JSON.parse( fs.readFileSync( full, 'utf8' ) ), file );
		if ( seen.has( parsed.caseId ) ) {
			throw new Error( `Duplicate caseId "${ parsed.caseId }" (in ${ file }).` );
		}
		seen.add( parsed.caseId );
		specs.push( parsed );
	}
	if ( only && only.length > 0 ) {
		const filter = new Set( only );
		const filtered = specs.filter( ( s ) => filter.has( s.caseId ) );
		const missing = only.filter( ( id ) => ! seen.has( id ) );
		if ( missing.length ) {
			throw new Error( `No spec(s) found for caseId(s): ${ missing.join( ', ' ) }` );
		}
		return filtered;
	}
	return specs;
}
