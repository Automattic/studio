const DEFAULT_AI_GATEWAY_BASE_URL = 'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy';

export function getAiGatewayBaseUrl(): string {
	const customBaseUrl = globalThis.process?.env.WPCOM_AI_PROXY_BASE_URL?.trim();
	return ( customBaseUrl || DEFAULT_AI_GATEWAY_BASE_URL ).replace( /\/+$/, '' );
}
