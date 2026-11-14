import { connectProvider } from '@studio/common/lib/ai-settings';
import { readProviderConfig } from '@studio/common/lib/provider-config';
import { startProviderConnect } from '@studio/common/lib/provider-connect';
import {
	ConnectError,
	getConnectFields,
	getConnectMethod,
	getProvider,
	type ConnectMethod,
	type ProviderConfigs,
	type ProviderId,
} from '@studio/providers';
import { getProviderServices } from '@studio/providers/services';
import { __, sprintf } from '@wordpress/i18n';
import { runCommand as runLoginCommand } from 'cli/commands/auth/login';
import { openBrowser } from 'cli/lib/browser';
import { input, password, select } from 'cli/lib/prompts';
import { LoggerError } from 'cli/logger';

export function readInlineWpcomToken(): string | undefined {
	return process.env.STUDIO_WPCOM_TOKEN?.trim() || undefined;
}

// `STUDIO_WPCOM_TOKEN` stands in for the Studio sign-in.
export function readInlineConfig< Id extends ProviderId >( provider: Id ) {
	const token = provider === 'wpcom' ? readInlineWpcomToken() : undefined;
	return token ? ( { token } as ProviderConfigs[ Id ] ) : undefined;
}

export async function isProviderConnected( provider: ProviderId ): Promise< boolean > {
	return ( readInlineConfig( provider ) ?? ( await readProviderConfig( provider ) ) ) !== undefined;
}

// Asks for a form's fields. The provider checks the values once the last one is entered, and a
// rejection asks again.
async function fillForm( provider: ProviderId, method: ConnectMethod ): Promise< void > {
	const fields = getConnectFields( method );
	const values: Record< string, string > = {};
	for ( const [ index, field ] of fields.entries() ) {
		const prompt = field.secret ? password : input;
		values[ field.name ] = await prompt( {
			message: sprintf(
				/* translators: %s: what the provider asks for, such as an API key */
				__( '%s (saved for future use):' ),
				field.title
			),
			...( field.secret ? { mask: '*' } : {} ),
			validate: async ( value: string ) => {
				const error = field.validate( value );
				if ( error || index < fields.length - 1 ) {
					return error ?? true;
				}
				try {
					await connectProvider( getProviderServices( provider ), method.id, {
						...values,
						[ field.name ]: value,
					} );
					return true;
				} catch ( rejection ) {
					if ( rejection instanceof ConnectError ) {
						return rejection.message;
					}
					throw rejection;
				}
			},
		} );
	}
}

// Signs in on the provider's site. A loopback sign-in comes back to this computer; over SSH it
// can't, so the user pastes the address the browser lands on instead.
async function signInOnSite( provider: ProviderId, method: ConnectMethod ): Promise< void > {
	const services = getProviderServices( provider );
	const { url, code, handoff } = await startProviderConnect( services, method.id );
	console.log(
		code
			? sprintf(
					/* translators: 1: a sign-in code, 2: a sign-in address */
					__( 'Approve the code %1$s at %2$s' ),
					code,
					url
			  )
			: sprintf(
					/* translators: %s: a sign-in address */
					__( 'Sign in at %s' ),
					url
			  )
	);
	await openBrowser( url ).catch( () => undefined );
	const pasting = new AbortController();
	try {
		await connectProvider( services, method.id, handoff, {
			pasteUrl:
				method.kind === 'loopback'
					? () =>
							input(
								{
									message: __(
										'Waiting for the browser. If it can’t reach this computer, paste the address it ends on:'
									),
								},
								{ signal: pasting.signal }
							)
					: undefined,
		} );
	} finally {
		pasting.abort();
	}
}

/**
 * Connects the provider the way it connects: the method first when it offers several, then the
 * method's form, a sign-in on its site, or the Studio sign-in. `force` connects it again when it
 * already is.
 */
export async function connectInTerminal(
	provider: ProviderId,
	options?: { force?: boolean }
): Promise< void > {
	if ( ! options?.force && ( await isProviderConnected( provider ) ) ) {
		return;
	}
	const { label, account } = getProvider( provider );
	const methodId =
		account.methods.length > 1
			? await select( {
					message: sprintf(
						/* translators: %s: provider name */
						__( 'How do you want to connect %s?' ),
						label
					),
					choices: account.methods.map( ( { id, label: methodLabel } ) => ( {
						value: id,
						name: methodLabel(),
					} ) ),
			  } )
			: undefined;
	const method = getConnectMethod( provider, methodId );
	const instructions = method.instructions?.();
	if ( instructions ) {
		console.log( instructions );
	}
	try {
		if ( method.kind === 'redirect' ) {
			await runLoginCommand();
		} else if ( method.kind === 'form' ) {
			await fillForm( provider, method );
		} else {
			await signInOnSite( provider, method );
		}
	} catch ( error ) {
		throw error instanceof ConnectError ? new LoggerError( error.message ) : error;
	}
}
