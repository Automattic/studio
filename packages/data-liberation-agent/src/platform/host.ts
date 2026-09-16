// src/platform/host.ts
//
// The public Host contract, and its registry.
//
// A Host is where a site is deployed — Netlify, Vercel, a CDN — as opposed to
// a Platform, which is what built the site. The distinction is not cosmetic:
// Platform.discover() is required because a platform owns routes, and a host
// owns none. A host cannot implement Platform and has no business competing
// with platform detection: a Wix site and a Netlify site are not mutually
// exclusive facts.
//
// What a host does own is the instrumentation it injects into pages it serves:
// badges, HUDs, RUM beacons. Those surfaces are evidence about the deployment,
// never about the source, so attributing them to the source misreports what a
// site contains. Recognition is evidence-based and narrow: a host declares the
// specific elements it injects, and matching one is never a statement that the
// rest of the page is trustworthy.
import type { CapabilityRule } from '../lib/inspect-rendered.js';

/** Response-header fingerprint, matched case-insensitively. */
export interface HostHttpSignal {
	header: string;
	/** When set, must appear as a case-insensitive substring of the value. */
	value?: string;
	/** Human-readable evidence recorded in the detection result. */
	signal: string;
}

/** Regex tested against the fetched page source (HTML). */
export interface HostSourceSignal {
	pattern: RegExp;
	/** Human-readable evidence recorded in the detection result. */
	signal: string;
}

/** Automatic-detection signals owned by a host. At least one is required. */
export interface HostDetection {
	httpSignals?: HostHttpSignal[];
	sourceSignals?: HostSourceSignal[];
}

/**
 * One surface a host injects into pages it serves. The selector must identify
 * that surface specifically; a rule broad enough to swallow authored content
 * would silently erase a real finding, which is worse than reporting one that
 * belongs to the host.
 */
export interface HostResidueRule {
	/** CSS selector for the injected element. */
	selector: string;
	/** Why this element belongs to the host, recorded on every exclusion. */
	evidence: string;
}

/** A deployment host. Detection and residue are both required: a host that
 * cannot be recognized, or that injects nothing, has nothing to contribute. */
export interface Host {
	/** Opaque, stable, unique id (e.g. 'netlify'). */
	id: string;
	detection: HostDetection;
	residue: HostResidueRule[];
}

/** A host detected on a response, with the evidence that identified it. */
export interface DetectedHost {
	id: string;
	evidence: string[];
	residue: HostResidueRule[];
}

/** Base class for deterministic host registration failures. */
export class HostRegistrationError extends Error {
	constructor( message: string ) {
		super( message );
		this.name = 'HostRegistrationError';
	}
}

const hosts = new Map< string, Host >();

function validateHost( host: Host ): void {
	if ( ! host || typeof host !== 'object' ) throw new HostRegistrationError( 'Host must be an object' );
	if ( typeof host.id !== 'string' || host.id.trim() === '' ) {
		throw new HostRegistrationError( 'Host.id must be a non-empty string' );
	}
	if ( hosts.has( host.id ) ) throw new HostRegistrationError( `A host is already registered with id '${ host.id }'` );
	const signals = ( host.detection?.httpSignals?.length ?? 0 ) + ( host.detection?.sourceSignals?.length ?? 0 );
	if ( ! signals ) throw new HostRegistrationError( `Host '${ host.id }' must declare at least one detection signal` );
	if ( ! Array.isArray( host.residue ) || host.residue.length === 0 ) {
		throw new HostRegistrationError( `Host '${ host.id }' must declare the surfaces it injects` );
	}
	for ( const rule of host.residue ) {
		if ( typeof rule?.selector !== 'string' || rule.selector.trim() === '' || rule.selector.length > 512 ) {
			throw new HostRegistrationError( `Host '${ host.id }' residue selectors must be bounded CSS selectors` );
		}
		if ( typeof rule.evidence !== 'string' || rule.evidence.trim() === '' ) {
			throw new HostRegistrationError( `Host '${ host.id }' residue rules must carry evidence` );
		}
	}
}

/** Register a deployment host. Registration problems throw. */
export function registerHost( host: Host ): void {
	validateHost( host );
	hosts.set( host.id, { id: host.id, detection: host.detection, residue: [ ...host.residue ] } );
}

/** Every registered host, in registration order. */
export function registeredHosts(): Host[] {
	return [ ...hosts.values() ];
}

/** Test seam: drop a registration. */
export function unregisterHost( id: string ): boolean {
	return hosts.delete( id );
}

/**
 * Recognize the hosts serving a response. Several may match — a site can sit
 * behind a CDN on top of a platform host — so this returns all of them.
 */
export function detectHosts( headers: Headers, html: string ): DetectedHost[] {
	const detected: DetectedHost[] = [];
	for ( const host of hosts.values() ) {
		const evidence: string[] = [];
		for ( const signal of host.detection.httpSignals ?? [] ) {
			const value = headers.get( signal.header );
			if ( value === null ) continue;
			if ( signal.value !== undefined && ! value.toLowerCase().includes( signal.value.toLowerCase() ) ) continue;
			evidence.push( signal.signal );
		}
		for ( const signal of host.detection.sourceSignals ?? [] ) {
			if ( html && signal.pattern.test( html ) ) evidence.push( signal.signal );
		}
		if ( evidence.length ) detected.push( { id: host.id, evidence, residue: host.residue } );
	}
	return detected;
}

/** Residue rules contributed by detected hosts, tagged with their owner. */
export function hostResidue( detected: DetectedHost[] ): Array< HostResidueRule & { host: string } > {
	return detected.flatMap( ( host ) => host.residue.map( ( rule ) => ( { ...rule, host: host.id } ) ) );
}

export type { CapabilityRule };
