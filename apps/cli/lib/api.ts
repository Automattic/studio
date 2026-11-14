import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { LoggerError } from 'cli/logger';

export async function deleteSnapshot( atomicSiteId: number, token: string ): Promise< void > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	try {
		await wpcom.req.post( {
			path: '/jurassic-ninja/delete',
			apiNamespace: 'wpcom/v2',
			body: { site_id: atomicSiteId },
		} );
	} catch ( error ) {
		if ( error instanceof Error && 'code' in error && error.code === 'rest_site_already_deleted' ) {
			return;
		}

		throw new LoggerError( __( 'Failed to delete preview site' ), error );
	}
}

export async function deleteAllSnapshots( token: string ): Promise< void > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	try {
		await wpcom.req.post( {
			path: '/jurassic-ninja/delete/all',
			apiNamespace: 'wpcom/v2',
		} );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to delete all preview sites' ), error );
	}
}

const userResponseSchema = z.object( {
	ID: z.number(),
	email: z.string().email(),
	display_name: z.string(),
	username: z.string(),
} );

export async function getUserInfo(
	token: string
): Promise< z.infer< typeof userResponseSchema > > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );
	try {
		const rawResponse = await wpcom.req.get( '/me', {
			fields: 'ID,username,email,display_name',
		} );
		return userResponseSchema.parse( rawResponse );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to fetch user info' ), error );
	}
}

export interface WpComSiteInfo {
	id: number;
	name: string;
	url: string;
}

const wpComSitesResponseSchema = z.object( {
	sites: z.array(
		z.object( {
			ID: z.number(),
			name: z.string(),
			URL: z.string(),
			is_deleted: z.boolean().optional(),
			is_a8c: z.boolean().optional(),
		} )
	),
} );

export async function getWpComSites( token: string ): Promise< WpComSiteInfo[] > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );
	try {
		const rawResponse = await wpcom.req.get(
			{
				apiNamespace: 'rest/v1.2',
				path: '/me/sites',
			},
			{
				fields: 'ID,name,URL,is_deleted,is_a8c',
				filter: 'atomic,wpcom',
				site_activity: 'active',
			}
		);
		const result = wpComSitesResponseSchema.parse( rawResponse );
		return result.sites
			.filter( ( site ) => ! site.is_deleted && ! site.is_a8c )
			.map( ( site ) => ( {
				id: site.ID,
				name: site.name,
				url: site.URL,
			} ) );
	} catch ( error ) {
		if ( error instanceof z.ZodError ) {
			throw new LoggerError( __( 'Invalid API response format' ), error );
		}
		throw new LoggerError( __( 'Failed to fetch WordPress.com sites' ), error );
	}
}
