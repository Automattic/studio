import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { wpcomClient } from '../api';
import type { SiteVisibility, SiteVisibilityDetails } from '../../types';

const wpcomSiteVisibilitySchema = z.enum( [ 'public', 'coming-soon', 'private' ] );
const siteIdSchema = z.number().int().positive();
const settingsSchema = z.object( {
	settings: z.object( {
		blog_public: z.coerce.number().refine( ( value ) => [ -1, 0, 1 ].includes( value ) ),
		wpcom_coming_soon: z.coerce.number().optional(),
		wpcom_public_coming_soon: z.coerce.number().optional(),
	} ),
} );
const siteSchema = z.object( {
	URL: z.string().url(),
	launch_status: z.string().optional(),
	jetpack: z.boolean().optional(),
	hosting_provider_guess: z.string().nullish(),
	is_wpcom_atomic: z.boolean().optional(),
} );

async function readVisibility( token: string, remoteSiteId: number ) {
	siteIdSchema.parse( remoteSiteId );
	const wpcom = wpcomClient( token );
	const site = siteSchema.parse(
		await wpcom.req.get(
			{ path: `/sites/${ remoteSiteId }`, apiVersion: '1.1' },
			{
				fields: 'ID,URL,launch_status,jetpack,is_wpcom_atomic,hosting_provider_guess',
			}
		)
	);
	if ( site.hosting_provider_guess === 'pressable' || ( site.jetpack && ! site.is_wpcom_atomic ) ) {
		const details: SiteVisibilityDetails = {
			visibility: 'unknown',
			availableValues: [],
			url: site.URL,
		};
		return { details };
	}
	const { settings } = settingsSchema.parse(
		await wpcom.req.get( { path: `/sites/${ remoteSiteId }/settings`, apiVersion: '1.4' } )
	);
	const visibility: SiteVisibility =
		settings.wpcom_coming_soon === 1 || settings.wpcom_public_coming_soon === 1
			? 'coming-soon'
			: settings.blog_public === -1
			? 'private'
			: site.launch_status === 'unlaunched'
			? 'coming-soon'
			: 'public';
	const details: SiteVisibilityDetails = {
		visibility,
		url: site.URL,
		launchStatus: site.launch_status,
	};
	return { details, settings };
}

export async function getWpcomSiteVisibility( token: string, remoteSiteId: number ) {
	return ( await readVisibility( token, remoteSiteId ) ).details;
}

export async function setWpcomSiteVisibility(
	token: string,
	remoteSiteId: number,
	visibility: SiteVisibility
): Promise< SiteVisibilityDetails > {
	wpcomSiteVisibilitySchema.parse( visibility );
	const { details, settings } = await readVisibility( token, remoteSiteId );
	if ( ! settings )
		throw new Error( __( 'Visibility settings are only available for WordPress.com sites.' ) );
	if ( details.visibility === visibility ) return details;
	const wpcom = wpcomClient( token );
	if ( visibility === 'public' && details.launchStatus === 'unlaunched' ) {
		await wpcom.req.post( { path: `/sites/${ remoteSiteId }/launch`, apiVersion: '1.1' } );
	}
	// Match WordPress.com's visibility settings, leaving unrelated sharing and SEO preferences alone.
	await wpcom.req.post( {
		path: `/sites/${ remoteSiteId }/settings`,
		apiVersion: '1.4',
		body: {
			blog_public:
				visibility === 'private'
					? -1
					: visibility === 'coming-soon'
					? 0
					: details.visibility === 'public'
					? settings.blog_public
					: 1,
			wpcom_public_coming_soon: visibility === 'coming-soon' ? 1 : 0,
			wpcom_coming_soon: 0,
		},
	} );
	const updated = await getWpcomSiteVisibility( token, remoteSiteId );
	if ( updated.visibility !== visibility ) {
		throw new Error(
			__( 'WordPress.com hasn’t confirmed the visibility change yet. Please try again.' )
		);
	}
	return updated;
}
