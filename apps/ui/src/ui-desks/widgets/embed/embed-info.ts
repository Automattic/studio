import {
	DEFAULT_EMBED_DEFINITIONS,
	embedShapePermissionDefaults,
	getEmbedInfo,
	type ResizeBoxOptions,
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

export function getEmbedResizeConstraints( url: string ): ResizeBoxOptions {
	const embedDefinition = getUrlEmbedInfo( url )?.definition;

	return {
		minWidth: embedDefinition?.minWidth ?? 200,
		minHeight: embedDefinition?.minHeight ?? 200,
	};
}
