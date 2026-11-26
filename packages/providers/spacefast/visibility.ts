import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { request } from './api';
import type { SiteVisibility, SiteVisibilityDetails } from '../types';

const grantSchema = z.object( {
	grant: z.object( {
		id: z.string(),
		audience: z.object( { kind: z.string() } ),
		capabilities: z.array( z.string() ),
		target: z.object( { kind: z.string() } ),
		resources: z.object( { include: z.array( z.string() ), exclude: z.array( z.string() ) } ),
		constraints: z.record( z.string(), z.unknown() ),
		source: z.object( { kind: z.string() } ),
	} ),
	status: z.enum( [ 'active', 'scheduled', 'expired' ] ),
	sourceExplanation: z.object( { editable: z.boolean() } ),
} );
const spaceSchema = z.object( {
	data: z.object( {
		liveUrl: z.string().url(),
		teamAccessPolicy: z.object( { privateSpacesOnly: z.boolean() } ).nullable(),
	} ),
} );
const operationSchema = z.object( {
	id: z.string(),
	status: z.enum( [ 'queued', 'running', 'succeeded', 'failed', 'canceled' ] ),
} );
const mutationSchema = z.object( { operation: operationSchema.nullable().optional() } );

function route( id: string ) {
	return `/v1/spaces/${ encodeURIComponent( id ) }`;
}

async function read( apiKey: string, id: string ) {
	const [ spaceResponse, grantsResponse ] = await Promise.all( [
		request( route( id ), { apiKey } ),
		request( `${ route( id ) }/grants`, { apiKey } ),
	] );
	const space = spaceSchema.parse( spaceResponse ).data;
	const grants = z.object( { data: z.array( grantSchema ) } ).parse( grantsResponse ).data;
	// Keep complex public access read-only, including access to individual versions.
	const publicGrants = grants.filter(
		( { grant, status } ) =>
			status !== 'expired' &&
			grant.audience.kind === 'public' &&
			grant.capabilities.includes( 'page.view' )
	);
	const fullPublic = publicGrants.some(
		( { grant, status } ) =>
			status === 'active' &&
			[ 'live', 'all_versions' ].includes( grant.target.kind ) &&
			grant.resources.include.includes( '/**' ) &&
			grant.resources.exclude.length === 0 &&
			Object.keys( grant.constraints ).length === 0
	);
	const complex = publicGrants.some(
		( { grant, status, sourceExplanation } ) =>
			status !== 'active' ||
			grant.target.kind !== 'live' ||
			grant.resources.include.length !== 1 ||
			grant.resources.include[ 0 ] !== '/**' ||
			grant.resources.exclude.length > 0 ||
			Object.keys( grant.constraints ).length > 0 ||
			grant.source.kind !== 'managed' ||
			! sourceExplanation.editable
	);
	const policyRestricted = space.teamAccessPolicy?.privateSpacesOnly === true;
	const details: SiteVisibilityDetails = {
		url: space.liveUrl,
		visibility: policyRestricted
			? 'private'
			: fullPublic
			? 'public'
			: publicGrants.length
			? 'unknown'
			: 'private',
		availableValues: complex ? [] : policyRestricted ? [ 'private' ] : [ 'private', 'public' ],
		...( complex
			? { message: __( 'Manage these access rules on Spacefast.' ) }
			: policyRestricted
			? { message: __( 'Your team only allows restricted sites.' ) }
			: {} ),
	};
	return { details, publicGrants };
}

async function waitForAccess( apiKey: string, response: unknown ) {
	let operation = mutationSchema.parse( response ).operation;
	const deadline = Date.now() + 30_000;
	while ( operation && operation.status !== 'succeeded' ) {
		if ( operation.status === 'failed' || operation.status === 'canceled' ) {
			throw new Error(
				__( 'The visibility change could not be applied. Check access on Spacefast.' )
			);
		}
		if ( Date.now() >= deadline ) {
			throw new Error(
				__( 'Spacefast is still applying the visibility change. Check access on Spacefast.' )
			);
		}
		await new Promise( ( resolve ) => setTimeout( resolve, 500 ) );
		const result = await request( `/v1/operations/${ encodeURIComponent( operation.id ) }`, {
			apiKey,
		} );
		operation = z.object( { data: operationSchema } ).parse( result ).data;
	}
}

export async function getVisibility(
	apiKey: string,
	id: string
): Promise< SiteVisibilityDetails > {
	return ( await read( apiKey, id ) ).details;
}

export async function setVisibility(
	apiKey: string,
	id: string,
	value: SiteVisibility
): Promise< SiteVisibilityDetails > {
	if ( value !== 'private' && value !== 'public' )
		throw new Error( __( 'Unsupported visibility setting.' ) );
	const { details, publicGrants } = await read( apiKey, id );
	if ( ! details.availableValues?.includes( value ) ) {
		throw new Error( details.message ?? __( 'Manage visibility on Spacefast.' ) );
	}
	if ( details.visibility === value ) return details;
	if ( value === 'public' ) {
		await waitForAccess(
			apiKey,
			await request( `${ route( id ) }/grants`, {
				apiKey,
				method: 'POST',
				body: {
					audience: { kind: 'public' },
					capabilities: [ 'page.view' ],
					resources: { include: [ '/**' ], exclude: [] },
					target: { kind: 'live' },
				},
			} )
		);
	} else {
		for ( const { grant } of publicGrants ) {
			await waitForAccess(
				apiKey,
				await request( `${ route( id ) }/grants/${ encodeURIComponent( grant.id ) }`, {
					apiKey,
					method: 'DELETE',
				} )
			);
		}
	}
	const confirmed = await getVisibility( apiKey, id );
	if ( confirmed.visibility !== value )
		throw new Error( __( 'Visibility could not be confirmed. Check access on Spacefast.' ) );
	return confirmed;
}
