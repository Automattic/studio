const DEFAULT_WPCOM_AI_GATEWAY_BASE_URL = 'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy';

export function getWpcomAiGatewayBaseUrl(): string {
	const customBaseUrl = globalThis.process?.env.WPCOM_AI_PROXY_BASE_URL?.trim();
	return customBaseUrl || DEFAULT_WPCOM_AI_GATEWAY_BASE_URL;
}

// Where Studio Code's model requests go on the proxy, and the headers that name
// the feature and the conversation to it. The capability tiers speak the
// OpenAI dialect, so the base URL carries the /v1 prefix.
export function getWpcomAiGatewayEndpoint( sessionId?: string ): {
	baseUrl: string;
	headers: Record< string, string >;
} {
	return {
		baseUrl: `${ getWpcomAiGatewayBaseUrl().replace( /\/+$/, '' ) }/v1`,
		headers: {
			'X-WPCOM-AI-Feature': 'studio-agent',
			...( sessionId ? { 'X-WPCOM-Session-ID': sessionId } : {} ),
		},
	};
}
