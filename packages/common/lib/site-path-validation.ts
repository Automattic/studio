import { __ } from '@wordpress/i18n';

interface SitePathDetails {
	path: string;
	isEmpty: boolean;
	isWordPress: boolean;
}

export interface ProposedSitePathDetails extends SitePathDetails {
	isNameTooLong?: boolean;
}

export interface SelectedSitePathDetails extends SitePathDetails {
	name?: string;
}

export interface PathValidationResult extends SitePathDetails {
	name?: string;
	error?: string;
}

function getContentsError( { isEmpty, isWordPress }: SitePathDetails, requiresEmptyPath: boolean ) {
	if ( isEmpty ) {
		return undefined;
	}
	if ( requiresEmptyPath ) {
		return __( 'Choose an empty folder for your site.' );
	}
	return isWordPress ? undefined : __( 'Choose an empty folder or an existing WordPress site.' );
}

export function validateProposedSitePath(
	result: ProposedSitePathDetails,
	pathExists: boolean,
	requiresEmptyPath = false
): PathValidationResult {
	const base = {
		path: result.path,
		isEmpty: result.isEmpty,
		isWordPress: result.isWordPress,
	};
	if ( result.isNameTooLong ) {
		return {
			...base,
			error: __( 'Use a shorter site name.' ),
		};
	}
	if ( pathExists ) {
		return {
			...base,
			error: __(
				'The directory is already associated with another Studio site. Please choose a different site name or a custom local path.'
			),
		};
	}
	const error = getContentsError( result, requiresEmptyPath );
	return error ? { ...base, error } : base;
}

export function validateSelectedSitePath(
	result: SelectedSitePathDetails,
	pathExists: boolean,
	requiresEmptyPath = false
): PathValidationResult {
	const base = {
		path: result.path,
		name: result.name,
		isEmpty: result.isEmpty,
		isWordPress: result.isWordPress,
	};
	if ( pathExists ) {
		return {
			...base,
			error: __(
				'The directory is already associated with another Studio site. Please choose a different custom local path.'
			),
		};
	}
	const error = getContentsError( result, requiresEmptyPath );
	return error ? { ...base, error } : base;
}
