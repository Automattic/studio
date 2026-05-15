import { __, sprintf } from '@wordpress/i18n';
import { DOLLY_MANAGE_STAGING_SITE_TOOL_ID } from 'src/modules/wpcom-site-assistant/lib/types';
import type { Ability } from '@automattic/agenttic-client';
import type { SyncSite } from '@studio/common/types/sync';

const getRecord = ( value: unknown ) =>
	value && typeof value === 'object' ? ( value as Record< string, unknown > ) : undefined;

const getStringValue = ( value: unknown ) => ( typeof value === 'string' ? value : undefined );

const getNumberValue = ( value: unknown ) => ( typeof value === 'number' ? value : undefined );

const getStagingCreationErrorDetails = ( error: unknown ) => {
	const errorRecord = getRecord( error );
	const data = errorRecord && 'data' in errorRecord ? errorRecord.data : error;
	const dataRecord = getRecord( data );
	const nestedDataRecord = getRecord( dataRecord?.data );

	return {
		code:
			getStringValue( dataRecord?.code ) ??
			getStringValue( dataRecord?.error ) ??
			getStringValue( errorRecord?.code ) ??
			getStringValue( errorRecord?.error ),
		message:
			data instanceof Error
				? data.message
				: getStringValue( dataRecord?.message ) ??
				  getStringValue( errorRecord?.message ) ??
				  ( error instanceof Error ? error.message : undefined ),
		status:
			getNumberValue( errorRecord?.status ) ??
			getNumberValue( dataRecord?.status ) ??
			getNumberValue( dataRecord?.statusCode ) ??
			getNumberValue( nestedDataRecord?.status ),
	};
};

const getStagingCreationErrorHint = ( code?: string ) => {
	switch ( code ) {
		case 'rest_cannot_view':
			return __(
				'This looks like an API permission restriction. The site may be eligible, but this OAuth client may not be allowed to manage staging sites for it yet.'
			);
		case 'staging_site_cannot_create':
			return __( 'WordPress.com says this site is not eligible for a staging site.' );
		case 'staging_site_cannot_create_more':
			return __( 'This production site already has the maximum number of staging sites.' );
		case 'staging_site_cannot_create_locked':
			return __( 'A staging-site creation is already in progress for this site.' );
		case 'staging_site_cannot_create_space_quota':
			return __( 'The site needs at least 50% free storage before staging can be created.' );
		case 'staging_site_cannot_create_jetpack_database_connection':
			return __(
				'Jetpack could not connect to the site database, so WordPress.com could not create the staging site.'
			);
		default:
			return undefined;
	}
};

export const getKnownStagingCreationBlocker = ( site: SyncSite ) => {
	if ( site.canManageOptions === false ) {
		return __( 'Your WordPress.com user needs admin access to create a staging site.' );
	}

	if ( isStagingPlanUpgradeRequired( site ) ) {
		return __( "This site's plan does not include staging sites." );
	}

	if ( site.isWpcomAtomic === false && site.hasStagingSiteFeature !== true ) {
		return __( 'This site does not appear to have WordPress.com hosting features enabled.' );
	}

	return undefined;
};

export const isStagingPlanUpgradeRequired = ( site: SyncSite ) =>
	site.hasStagingSiteFeature === false;

const getSiteSlug = ( site: SyncSite ) => {
	try {
		return new URL( site.url ).hostname;
	} catch {
		return site.url.replace( /^https?:\/\//, '' ).replace( /\/.*$/, '' );
	}
};

export const getStagingPlanUpgradeUrl = ( site: SyncSite ) => {
	const siteSlug = getSiteSlug( site );
	const returnPath = `/sites/${ siteSlug }/settings/hosting`;
	const url = new URL( 'https://wordpress.com/setup/plan-upgrade/plans' );
	url.searchParams.set( 'siteSlug', siteSlug );
	url.searchParams.set( 'cancel_to', returnPath );
	url.searchParams.set( 'redirect_to', returnPath );
	url.searchParams.set( 'dashboard', 'dotcom' );
	url.searchParams.set( 'feature', 'staging-sites' );
	url.searchParams.set( 'ref', 'studio' );
	return url.toString();
};

export const getStagingCreationErrorMessage = ( error: unknown, site: SyncSite ) => {
	const { code, message, status } = getStagingCreationErrorDetails( error );
	const details = [
		message ?? __( 'Studio could not create a staging site. Please try again.' ),
		code || status
			? sprintf(
					/* translators: %1$s is a WordPress.com API error code, %2$s is an HTTP status code. */
					__( 'WordPress.com returned %1$s%2$s.' ),
					code ? `code "${ code }"` : __( 'an error' ),
					status ? ` (${ status })` : ''
			  )
			: undefined,
		getStagingCreationErrorHint( code ) ?? getKnownStagingCreationBlocker( site ),
	].filter( ( value ): value is string => Boolean( value ) );

	return details.join( '\n\n' );
};

export const createDollyManageStagingSiteAbility = (
	callback: NonNullable< Ability[ 'callback' ] >
): Ability => ( {
	name: DOLLY_MANAGE_STAGING_SITE_TOOL_ID,
	label: 'Manage Staging Site',
	description:
		'Create and manage a staging site for the selected WordPress.com production site. Studio currently supports creating one staging site from the selected production site.',
	category: 'site-management',
	input_schema: {
		type: 'object',
		properties: {
			action: {
				type: 'string',
				enum: [ 'create' ],
				description: 'The staging-site action to perform. Currently only create is supported.',
			},
		},
		required: [ 'action' ],
	},
	output_schema: {
		type: 'object',
		properties: {
			success: { type: 'boolean' },
			action: { type: 'string' },
			siteId: { type: 'number' },
			stagingSiteId: { type: 'number' },
			url: { type: 'string' },
			message: { type: 'string' },
			error: { type: 'string' },
		},
	},
	meta: {
		annotations: {
			instructions:
				'Use when the user asks to create, make, or set up a staging site for the selected WordPress.com production site. Do not use for local Studio sites, staging sites, or production sites that already have a staging site.',
			readonly: false,
			destructive: false,
			idempotent: true,
		},
	},
	callback,
} );
