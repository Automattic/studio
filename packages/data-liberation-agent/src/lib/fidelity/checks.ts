// src/lib/fidelity/checks.ts
//
// The comparison extension point.
//
// A check inspects one route at one viewport and reports what diverged. The
// built-in comparison registers through this same call rather than a
// privileged branch, because a door only one caller can open is not a door.
//
// Checks may be async and may write their own evidence, because the useful
// ones are not pure functions of an observation: a visual comparison shells
// out to a browser harness, captures its own screenshots, and leaves artifacts
// behind. Handing a check the target URLs as well as the observations lets it
// do its own looking instead of being limited to what this module already
// measured.
//
import { scoreViewport, type LayoutObservation } from './score.js';
import {
	checkImageGeometry,
	checkMotion,
	checkTypography,
} from './rendered-contract-checks.js';

export interface FidelityCheckContext {
	/** Route in the copy, e.g. `/` or `/about/`. */
	route: string;
	viewport: number;
	/** Live source URL for this route. */
	sourceUrl: string;
	/** Local URL serving the liberated copy of this route. */
	candidateUrl: string;
	source: LayoutObservation;
	candidate: LayoutObservation;
	/** Directory a check may write evidence into. Created on demand by the check. */
	evidenceDir: string;
}

export interface FidelityCheckResult {
	/** Divergences that fail the run. */
	failures?: string[];
	/** Observations worth reporting that do not fail the run. */
	notes?: string[];
	/** Paths to evidence this check wrote, for the report to reference. */
	artifacts?: string[];
}

export interface FidelityCheck {
	/** Unique name. Also how a consumer replaces or removes this check. */
	name: string;
	run(
		context: FidelityCheckContext
	): FidelityCheckResult | Promise< FidelityCheckResult >;
}

export interface RegisterCheckOptions {
	/** Replace an existing registration of the same name. */
	replace?: boolean;
}

const checks = new Map< string, FidelityCheck >();

/**
 * Make a check part of `data-liberation compare`.
 *
 * Duplicate names throw rather than silently overwrite: two checks quietly
 * claiming one name is the kind of thing that surfaces as a mystery when a
 * gate passes something it should have caught.
 */
export function registerFidelityCheck(
	check: FidelityCheck,
	options: RegisterCheckOptions = {}
): void {
	const name = check.name.trim().toLowerCase();
	if ( ! name ) throw new Error( 'A fidelity check needs a name.' );
	if ( checks.has( name ) && ! options.replace ) {
		throw new Error(
			`Fidelity check "${ name }" is already registered. Pass { replace: true } to override it.`
		);
	}
	checks.set( name, { ...check, name } );
}

/** Remove a registration. For tests, and for hosts swapping a check. */
export function unregisterFidelityCheck( name: string ): boolean {
	return checks.delete( name.trim().toLowerCase() );
}

export function findFidelityCheck( name: string ): FidelityCheck | null {
	return checks.get( name.trim().toLowerCase() ) ?? null;
}

export function fidelityCheckNames(): string[] {
	return [ ...checks.keys() ].sort();
}

/**
 * Run every registered check against one route at one viewport.
 *
 * A check that throws is reported as a failure under its own name rather than
 * aborting the run: one badly behaved consumer should not be able to silence
 * the rest of the gate, and a check that cannot run is itself a finding.
 */
export async function runFidelityChecks(
	context: FidelityCheckContext
): Promise< Required< FidelityCheckResult > > {
	const failures: string[] = [];
	const notes: string[] = [];
	const artifacts: string[] = [];

	for ( const check of checks.values() ) {
		try {
			const result = await check.run( context );
			failures.push( ...( result.failures ?? [] ) );
			notes.push( ...( result.notes ?? [] ) );
			artifacts.push( ...( result.artifacts ?? [] ) );
		} catch ( error ) {
			failures.push(
				`check "${ check.name }" failed to run: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	}

	return { failures, notes, artifacts };
}

/**
 * The built-in comparison: everything `scoreViewport` measures from a pair of
 * observations — title, text, geometry, rendered images, overflow, external
 * hosts, same-page anchors, internal links, dialogs.
 *
 * Registered here rather than called directly so that the built-in and any
 * contributed check enter through the same door. A consumer that wants
 * different semantics can replace it by name.
 */
registerFidelityCheck( {
	name: 'core',
	run: ( { source, candidate } ) => {
		const score = scoreViewport( source, candidate );
		return { failures: score.failures, notes: score.notes };
	},
} );

registerFidelityCheck( {
	name: 'image-geometry',
	run: ( { source, candidate } ) => checkImageGeometry( source, candidate ),
} );

registerFidelityCheck( {
	name: 'typography',
	run: ( { source, candidate } ) => checkTypography( source, candidate ),
} );

registerFidelityCheck( {
	name: 'motion',
	run: ( { source, candidate } ) => checkMotion( source, candidate ),
} );
