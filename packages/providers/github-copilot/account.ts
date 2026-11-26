import { __ } from '@wordpress/i18n';
import { ConnectError, NotConnectedError } from '../errors';
import { CLIENT_ID, request } from './api';
import { DEFAULT_MODEL_IDS, labelOf, readPlanModels } from './catalog';
import type { GithubCopilotConfig } from './config';
import type { AccountServices } from '../types';

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
		throw new ConnectError( getNoCopilotMessage(), 'ineligible' );
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

type GithubCopilotAccount = AccountServices< GithubCopilotConfig >;

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
		throw error instanceof ConnectError ? error : new ConnectError( error.message, 'unverified' );
	} );
	const [ login, models ] = await Promise.all( [
		readLogin( githubToken ),
		readPlanModels( copilot.copilotToken, DEFAULT_MODEL_IDS ),
	] );
	if ( models?.length === 0 ) {
		throw new ConnectError( getNoCopilotMessage(), 'ineligible' );
	}
	// A plan that runs none of Studio's models offers its own until the user picks.
	const picked =
		models && ! models.some( ( id ) => DEFAULT_MODEL_IDS.includes( id ) )
			? models.map( ( id ) => ( { id, label: labelOf( id ) } ) )
			: undefined;
	return {
		method: 'github',
		githubToken,
		...copilot,
		...( login ? { login } : {} ),
		...( models ? { models } : {} ),
		...( picked ? { picked } : {} ),
	};
};

// Renewing also re-reads the plan's models, so one added to or dropped from it shows up without
// connecting again.
const refresh: NonNullable< GithubCopilotAccount[ 'refresh' ] > = async ( config ) => {
	if ( config.copilotTokenExpiresAt - Date.now() > REFRESH_MARGIN_MS ) {
		return undefined;
	}
	const copilot = await requestCopilotToken( config.githubToken );
	const models = await readPlanModels(
		copilot.copilotToken,
		config.picked?.map( ( { id } ) => id ) ?? DEFAULT_MODEL_IDS
	);
	return { ...config, ...copilot, ...( models ? { models } : {} ) };
};

export const githubCopilotAccount: GithubCopilotAccount = { start, connect, refresh };
