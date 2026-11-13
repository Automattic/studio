import { __ } from '@wordpress/i18n';
import { ConnectError, NotConnectedError } from '../errors';
import { toCopilotModelId } from './ai';
import { CLIENT_ID, copilotApiUrl, request } from './api';
import { GITHUB_COPILOT_AI_MODELS } from './descriptor';
import type { GithubCopilotConfig } from './config';
import type { ProviderServices } from '../types';

const REFRESH_MARGIN_MS = 5 * 60_000;

const sleep = ( ms: number ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );

const getNoCopilotMessage = () =>
	__( 'This GitHub account has no Copilot plan. Pick a plan on github.com/features/copilot.' );

async function postForm( url: string, body: Record< string, string > ) {
	const response = await request( url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams( { client_id: CLIENT_ID, ...body } ),
	} );
	if ( ! response.ok ) {
		throw new Error( `GitHub sign-in failed (${ response.status }).` );
	}
	return ( await response.json() ) as Record< string, unknown >;
}

// The short-lived token Copilot's API takes, which the GitHub sign-in renews.
async function requestCopilotToken(
	githubToken: string
): Promise< Pick< GithubCopilotConfig, 'copilotToken' | 'copilotTokenExpiresAt' > > {
	const response = await request( 'https://api.github.com/copilot_internal/v2/token', {
		headers: { Authorization: `Bearer ${ githubToken }` },
	} );
	if ( response.status === 401 ) {
		throw new NotConnectedError( 'Your GitHub sign-in expired. Connect GitHub Copilot again.' );
	}
	if ( response.status === 403 || response.status === 404 ) {
		throw new Error( getNoCopilotMessage() );
	}
	if ( ! response.ok ) {
		throw new Error( `GitHub Copilot sign-in could not be renewed (${ response.status }).` );
	}
	const { token, expires_at } = ( await response.json() ) as {
		token: string;
		expires_at: number;
	};
	return { copilotToken: token, copilotTokenExpiresAt: expires_at * 1000 };
}

async function readLogin( githubToken: string ): Promise< string | undefined > {
	const response = await request( 'https://api.github.com/user', {
		headers: { Authorization: `Bearer ${ githubToken }` },
	} ).catch( () => undefined );
	const user = response?.ok ? ( ( await response.json() ) as { login?: string } ) : undefined;
	return user?.login;
}

// Some plans leave a model off until it's turned on, as Copilot Chat asks to.
async function enableModels( copilotToken: string ): Promise< void > {
	await Promise.allSettled(
		GITHUB_COPILOT_AI_MODELS.map( ( { id } ) =>
			request( `${ copilotApiUrl( copilotToken ) }/models/${ toCopilotModelId( id ) }/policy`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${ copilotToken }`,
					'Content-Type': 'application/json',
					'openai-intent': 'chat-policy',
					'x-interaction-type': 'chat-policy',
				},
				body: JSON.stringify( { state: 'enabled' } ),
			} )
		)
	);
}

// Polls until the user approves the code, as GitHub's device flow asks.
async function waitForGithubToken( deviceCode: string, interval: number, expiresAt: number ) {
	let wait = interval;
	while ( Date.now() < expiresAt ) {
		await sleep( wait * 1000 );
		const result = await postForm( 'https://github.com/login/oauth/access_token', {
			device_code: deviceCode,
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
		} );
		if ( typeof result.access_token === 'string' ) {
			return result.access_token;
		}
		if ( result.error === 'slow_down' ) {
			wait = typeof result.interval === 'number' ? result.interval : wait + 5;
		} else if ( result.error === 'access_denied' ) {
			throw new ConnectError( __( 'GitHub sign-in was declined.' ), 'denied' );
		} else if ( result.error !== 'authorization_pending' ) {
			break;
		}
	}
	throw new ConnectError( __( 'The GitHub sign-in expired. Try again.' ), 'denied' );
}

type GithubCopilotAccount = ProviderServices< GithubCopilotConfig >[ 'account' ];

const start: NonNullable< GithubCopilotAccount[ 'start' ] > = async () => {
	const device = await postForm( 'https://github.com/login/device/code', { scope: 'read:user' } );
	return {
		url: String( device.verification_uri ),
		code: String( device.user_code ),
		handoff: {
			deviceCode: String( device.device_code ),
			interval: String( device.interval ?? 5 ),
			expiresAt: String( Date.now() + Number( device.expires_in ) * 1000 ),
		},
	};
};

// Takes back the handoff `start` returned, and resolves once the user approves the code.
const connect: GithubCopilotAccount[ 'connect' ] = async ( _method, input ) => {
	const interval = Number( input.interval );
	const expiresAt = Number( input.expiresAt );
	if ( ! input.deviceCode || ! interval || ! expiresAt ) {
		throw new ConnectError( __( 'Start signing in with GitHub again.' ) );
	}
	const githubToken = await waitForGithubToken( input.deviceCode, interval, expiresAt );
	const copilot = await requestCopilotToken( githubToken ).catch( ( error: Error ) => {
		throw new ConnectError( error.message, 'unverified' );
	} );
	const [ login ] = await Promise.all( [
		readLogin( githubToken ),
		enableModels( copilot.copilotToken ),
	] );
	return { method: 'github', githubToken, ...copilot, ...( login ? { login } : {} ) };
};

const refresh: NonNullable< GithubCopilotAccount[ 'refresh' ] > = async ( config ) => {
	if ( config.copilotTokenExpiresAt - Date.now() > REFRESH_MARGIN_MS ) {
		return undefined;
	}
	return { ...config, ...( await requestCopilotToken( config.githubToken ) ) };
};

export const githubCopilotAccount: GithubCopilotAccount = { start, connect, refresh };
