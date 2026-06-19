export const STUDIO_CHAT_ARTIFACT_VERSION = 1 as const;

export interface StudioChatSitePreviewArtifact {
	path: string;
	siteId?: string;
	siteName?: string;
	sitePath?: string;
	url?: string;
}

export interface StudioChatArtifactData {
	version: typeof STUDIO_CHAT_ARTIFACT_VERSION;
	id: string;
	sitePreview: StudioChatSitePreviewArtifact;
}

export function isStudioChatArtifactData( value: unknown ): value is StudioChatArtifactData {
	const candidate = value as Partial< StudioChatArtifactData >;
	return (
		isRecord( value ) &&
		candidate.version === STUDIO_CHAT_ARTIFACT_VERSION &&
		typeof candidate.id === 'string' &&
		isStudioChatSitePreviewArtifact( candidate.sitePreview )
	);
}

function isStudioChatSitePreviewArtifact( value: unknown ): value is StudioChatSitePreviewArtifact {
	const candidate = value as Partial< StudioChatSitePreviewArtifact >;
	return (
		isRecord( value ) &&
		typeof candidate.path === 'string' &&
		( candidate.siteId === undefined || typeof candidate.siteId === 'string' ) &&
		( candidate.siteName === undefined || typeof candidate.siteName === 'string' ) &&
		( candidate.sitePath === undefined || typeof candidate.sitePath === 'string' ) &&
		( candidate.url === undefined || typeof candidate.url === 'string' )
	);
}

function isRecord( value: unknown ): value is Record< string, unknown > {
	return Boolean( value ) && typeof value === 'object' && ! Array.isArray( value );
}
