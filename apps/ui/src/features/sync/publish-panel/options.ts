import { __ } from '@wordpress/i18n';
import type { PullSyncOptions, PushSyncOptions, SyncSite } from '@/data/core';

export type PublishView = 'publish' | 'pull' | 'websites';
export type PublishScope = 'all' | 'files' | 'content' | 'custom';
export type TransferDirection = 'push' | 'pull';
export type TransferOptions = { push: PushSyncOptions; pull: PullSyncOptions };

export function scopeLabel( scope: PublishScope ) {
	switch ( scope ) {
		case 'all':
			return __( 'Files, content, and settings' );
		case 'files':
			return __( 'Files only' );
		case 'content':
			return __( 'Content and settings only' );
		case 'custom':
			return __( 'Selected files and content' );
	}
}

export function presetOptions( scope: Exclude< PublishScope, 'custom' > ): TransferOptions {
	const optionsToSync: PushSyncOptions[ 'optionsToSync' ] =
		scope === 'all'
			? [ 'all' ]
			: scope === 'content'
			? [ 'sqls' ]
			: [ 'plugins', 'themes', 'uploads', 'contents' ];
	return { push: { optionsToSync }, pull: { optionsToSync } };
}

export function overwriteDescription( scope: PublishScope, direction: TransferDirection ) {
	if ( direction === 'pull' ) {
		switch ( scope ) {
			case 'files':
				return __(
					'Matching files in WordPress Studio will be overwritten. Your website stays unchanged.'
				);
			case 'content':
				return __(
					'All content and settings in WordPress Studio will be overwritten. Your website stays unchanged.'
				);
			case 'custom':
				return __(
					'The selected files and content in WordPress Studio will be overwritten. Your website stays unchanged.'
				);
			default:
				return __(
					'Matching files and all content and settings in WordPress Studio will be overwritten. Your website stays unchanged.'
				);
		}
	}
	switch ( scope ) {
		case 'files':
			return __( 'Matching files on the website will be overwritten.' );
		case 'content':
			return __( 'All content and settings on the website will be overwritten.' );
		case 'custom':
			return __( 'The selected files and content on the website will be overwritten.' );
		default:
			return __(
				'Matching files and all content and settings on the website will be overwritten.'
			);
	}
}

export function websiteIssue( site: SyncSite ) {
	switch ( site.syncSupport ) {
		case 'deleted':
			return __( 'This website has been deleted. Choose another website.' );
		case 'missing-permissions':
			return __( 'You need administrator access to publish or pull changes.' );
		case 'needs-upgrade':
			return __(
				'This website needs a hosting plan that supports publishing from WordPress Studio.'
			);
		case 'needs-transfer':
			return __( 'Finish activating hosting on WordPress.com before publishing.' );
		case 'unsupported':
			return __( 'Publishing and pulling require a supported WordPress.com or Pressable website.' );
		default:
			return null;
	}
}

export function backupsUrl( site: SyncSite ) {
	if ( site.isPressable ) {
		return undefined;
	}
	try {
		return `https://wordpress.com/backup/${ new URL( site.url ).hostname }`;
	} catch {
		return undefined;
	}
}

function websiteEnvironment( site: SyncSite ) {
	if (
		site.isPressable &&
		( site.environmentType === 'staging' || site.environmentType === 'development' )
	) {
		return site.environmentType;
	}
	return site.isStaging ? 'staging' : 'production';
}

export function websiteEnvironmentLabel( site: SyncSite ) {
	switch ( websiteEnvironment( site ) ) {
		case 'staging':
			return __( 'Staging' );
		case 'development':
			return __( 'Development' );
		default:
			return __( 'Production' );
	}
}

export function websiteAddress( site: SyncSite ) {
	return site.url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}

export function dashboardUrl( site: SyncSite ) {
	if ( site.isPressable ) return undefined;
	try {
		return `https://my.wordpress.com/sites/${ new URL( site.url ).hostname }`;
	} catch {
		return undefined;
	}
}

export function domainsUrl( site: SyncSite ) {
	const dashboard = dashboardUrl( site );
	return dashboard ? `${ dashboard }/domains` : undefined;
}
