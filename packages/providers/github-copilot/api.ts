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

// A model as the plan lists it: `policy` says whether the account may use it, and an
// `unconfigured` one has to be turned on first.
export interface PlanModel {
	id: string;
	toolCalls: boolean;
	policy?: string;
}

// Every model the plan lists, or undefined when Copilot doesn't say.
export async function fetchPlanModels( copilotToken: string ): Promise< PlanModel[] | undefined > {
	const response = await request( `${ copilotApiUrl( copilotToken ) }/models`, {
		headers: { Authorization: `Bearer ${ copilotToken }` },
	} ).catch( () => undefined );
	if ( ! response?.ok ) {
		return undefined;
	}
	const { data } = ( await response.json().catch( () => ( {} ) ) ) as {
		data?: {
			id?: unknown;
			capabilities?: { supports?: { tool_calls?: unknown } };
			policy?: { state?: unknown };
		}[];
	};
	return Array.isArray( data )
		? data.flatMap( ( model ) =>
				typeof model.id === 'string'
					? [
							{
								id: model.id,
								toolCalls: model.capabilities?.supports?.tool_calls !== false,
								policy: typeof model.policy?.state === 'string' ? model.policy.state : undefined,
							},
					  ]
					: []
		  )
		: undefined;
}

// Turns a model on for the account, as Copilot Chat asks to for a model left off.
export async function enablePlanModel( copilotToken: string, modelId: string ): Promise< boolean > {
	const response = await request( `${ copilotApiUrl( copilotToken ) }/models/${ modelId }/policy`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${ copilotToken }`,
			'Content-Type': 'application/json',
			'openai-intent': 'chat-policy',
			'x-interaction-type': 'chat-policy',
		},
		body: JSON.stringify( { state: 'enabled' } ),
	} ).catch( () => undefined );
	return response?.ok === true;
}
