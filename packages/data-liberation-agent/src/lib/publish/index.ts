// src/lib/publish/index.ts
//
// The publish extension point.
//
// Targets register through `registerPublishTarget`, and the built-in targets
// use that same call rather than a privileged array. If a built-in ever needs
// a back door, the API is not good enough — dogfooding it is what keeps it
// honest for anyone embedding this package.
//
import { spacefastTarget } from './spacefast.js';
import type { PublishTarget } from './types.js';

const targets = new Map< string, PublishTarget >();

export interface RegisterOptions {
	/** Replace an existing registration of the same name. */
	replace?: boolean;
}

/**
 * Make a destination available to `data-liberation publish --to <name>`.
 *
 * Duplicate names throw rather than silently overwrite: two targets quietly
 * claiming one name is the kind of thing that surfaces as a mystery at publish
 * time, when bytes are already going somewhere.
 */
export function registerPublishTarget( target: PublishTarget, options: RegisterOptions = {} ): void {
	const name = target.name.trim().toLowerCase();
	if ( ! name ) throw new Error( 'A publish target needs a name.' );
	if ( targets.has( name ) && ! options.replace ) {
		throw new Error(
			`Publish target "${ name }" is already registered. Pass { replace: true } to override it.`
		);
	}
	targets.set( name, target );
}

/** Remove a registration. Mainly for tests and hosts swapping targets. */
export function unregisterPublishTarget( name: string ): boolean {
	return targets.delete( name.trim().toLowerCase() );
}

export function findPublishTarget( name: string ): PublishTarget | null {
	return targets.get( name.trim().toLowerCase() ) ?? null;
}

export function publishTargetNames(): string[] {
	return [ ...targets.keys() ].sort();
}

// Built-ins go through the public API, exactly as an external target would.
registerPublishTarget( spacefastTarget );

export { PublishError } from './types.js';
export type { PublishOptions, PublishResult, PublishTarget } from './types.js';
