// Copilot's API accepts the clients GitHub lists for Copilot. Like pi's
// `github-copilot` provider, Studio signs in and calls it as Copilot Chat.
export const CLIENT_ID = 'Iv1.b507a08c87ecfe98';

export const COPILOT_HEADERS = {
	'User-Agent': 'GitHubCopilotChat/0.35.0',
	'Editor-Version': 'vscode/1.107.0',
	'Editor-Plugin-Version': 'copilot-chat/0.35.0',
	'Copilot-Integration-Id': 'vscode-chat',
};

const REQUEST_TIMEOUT_MS = 15_000;

export function request( url: string, init: RequestInit = {} ): Promise< Response > {
	return fetch( url, {
		...init,
		headers: { Accept: 'application/json', ...COPILOT_HEADERS, ...init.headers },
		signal: AbortSignal.timeout( REQUEST_TIMEOUT_MS ),
	} );
}

// The token names the API its plan uses, such as `proxy.business.githubcopilot.com`.
export function copilotApiUrl( copilotToken: string ): string {
	const host = /proxy-ep=([^;]+)/.exec( copilotToken )?.[ 1 ];
	return host ? `https://${ host.replace( /^proxy\./, 'api.' ) }` : 'https://api.githubcopilot.com';
}
