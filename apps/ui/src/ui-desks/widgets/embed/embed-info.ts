import {
	DEFAULT_EMBED_DEFINITIONS,
	embedShapePermissionDefaults,
	getEmbedInfo,
	type TLEmbedResult,
	type TLEmbedShapePermissions,
} from 'tldraw';

export function getUrlEmbedInfo( url: string ): TLEmbedResult {
	return getEmbedInfo( DEFAULT_EMBED_DEFINITIONS, url );
}

export function getEmbedSandboxPermissions( overridePermissions?: TLEmbedShapePermissions ) {
	return Object.entries( {
		...embedShapePermissionDefaults,
		...( overridePermissions ?? {} ),
	} )
		.filter( ( [ , isEnabled ] ) => isEnabled )
		.map( ( [ permission ] ) => permission )
		.join( ' ' );
}
