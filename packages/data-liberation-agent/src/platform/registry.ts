// src/platform/registry.ts
//
// The single platform registry — one home for adapter registration AND the
// automatic-detection signals those platforms own. Adding a platform (built-in
// or third-party) means calling registerPlatform; nothing else in core needs
// to be edited. Registration problems fail deterministically: a bad or
// ambiguous registration throws rather than being silently reordered,
// shadowed, or ignored.
import type { Platform, RegisterPlatformOptions } from './types.js';

/** Sentinel detection result when no platform's signals matched. Reserved. */
export const UNKNOWN_PLATFORM_ID = 'unknown';

/** Base class for deterministic registration failures. */
export class PlatformRegistrationError extends Error {
	constructor( message: string ) {
		super( message );
		this.name = 'PlatformRegistrationError';
	}
}

/** A platform object failed validation (missing/invalid id or discover). */
export class InvalidPlatformError extends PlatformRegistrationError {
	constructor( message: string ) {
		super( message );
		this.name = 'InvalidPlatformError';
	}
}

/** A platform with this id is already registered. */
export class DuplicatePlatformError extends PlatformRegistrationError {
	constructor( id: string ) {
		super( `A platform is already registered with id '${ id }'` );
		this.name = 'DuplicatePlatformError';
	}
}

/** A fallback platform is already registered; only one may exist. */
export class ConflictingFallbackError extends PlatformRegistrationError {
	constructor( existingId: string ) {
		super(
			`A fallback platform is already registered ('${ existingId }'); at most one fallback may be registered`,
		);
		this.name = 'ConflictingFallbackError';
	}
}

const platforms = new Map< string, Platform >();
let fallback: Platform | null = null;

function validatePlatform( platform: Platform, options: RegisterPlatformOptions ): void {
	if ( ! platform || typeof platform !== 'object' ) {
		throw new InvalidPlatformError( 'Platform must be an object' );
	}
	if ( typeof platform.id !== 'string' || platform.id.trim() === '' ) {
		throw new InvalidPlatformError( 'Platform.id must be a non-empty string' );
	}
	if ( platform.id === UNKNOWN_PLATFORM_ID ) {
		throw new InvalidPlatformError(
			`Platform id '${ UNKNOWN_PLATFORM_ID }' is reserved for detection misses and cannot be registered`,
		);
	}
	if ( typeof platform.discover !== 'function' ) {
		throw new InvalidPlatformError( `Platform '${ platform.id }' must provide a discover() function` );
	}
	const detection = platform.detection;
	if ( detection != null ) {
		if ( typeof detection !== 'object' ) {
			throw new InvalidPlatformError( `Platform '${ platform.id }' detection must be an object` );
		}
		for ( const tier of [ 'urlPatterns', 'httpSignals', 'sourceSignals', 'pathProbes' ] as const ) {
			const signals = detection[ tier ];
			if ( signals != null && ! Array.isArray( signals ) ) {
				throw new InvalidPlatformError(
					`Platform '${ platform.id }' detection.${ tier } must be an array`,
				);
			}
		}
	}
	if ( options.fallback && detection != null ) {
		throw new InvalidPlatformError(
			`Fallback platform '${ platform.id }' must not declare detection signals — fallback selection is implicit, so detection would be ambiguous`,
		);
	}
}

/**
 * Register a platform. This is the ONE registration seam for built-in and
 * third-party platforms alike: the registry it populates drives both adapter
 * resolution and automatic detection.
 *
 * @throws {DuplicatePlatformError} id already registered.
 * @throws {ConflictingFallbackError} `{ fallback: true }` when a fallback exists.
 * @throws {InvalidPlatformError} malformed platform, reserved id, or an
 *   ambiguous fallback-with-detection registration.
 */
export function registerPlatform(
	platform: Platform,
	options: RegisterPlatformOptions = {},
): Platform {
	validatePlatform( platform, options );
	if ( platforms.has( platform.id ) ) {
		throw new DuplicatePlatformError( platform.id );
	}
	if ( options.fallback && fallback ) {
		throw new ConflictingFallbackError( fallback.id );
	}
	platforms.set( platform.id, platform );
	if ( options.fallback ) fallback = platform;
	return platform;
}

/** All registered platforms, in registration order (deterministic). */
export function registeredPlatforms(): Platform[] {
	return [ ...platforms.values() ];
}

/** Exact-id lookup. Never falls back. */
export function findPlatform( id: string ): Platform | null {
	return platforms.get( id ) ?? null;
}

/** The registered generic fallback, if any. */
export function fallbackPlatform(): Platform | null {
	return fallback;
}

/**
 * Resolve a detected platform id to a platform, falling back to the
 * registered fallback when the id names nothing (e.g. detection returned
 * 'unknown'). An exact match always wins over the fallback.
 */
export function resolvePlatform( id: string ): Platform | null {
	return platforms.get( id ) ?? fallback;
}
