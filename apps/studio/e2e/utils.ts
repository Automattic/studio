export function getUrlWithAutoLogin( destinationUrl: string ): string {
	const parsedUrl = new URL( destinationUrl );
	const baseUrl = `${ parsedUrl.protocol }//${ parsedUrl.hostname }:${ parsedUrl.port }`;
	return `${ baseUrl }/studio-auto-login?redirect_to=${ encodeURIComponent( destinationUrl ) }`;
}
