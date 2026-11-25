import { changeAiSettings } from '@studio/common/lib/ai-provider-tracks';
import { connectProvider } from '@studio/common/lib/ai-settings';
import { readProviderConfig } from '@studio/common/lib/provider-config';
import { startProviderConnect } from '@studio/common/lib/provider-connect';
import {
	ConnectError,
	getFormFields,
	getConnectMethod,
	getProvider,
	type ConnectMethod,
	type FormField,
	type ProviderConfigs,
	type ProviderId,
} from '@studio/providers';
import { getProviderServices } from '@studio/providers/services';
import { __, sprintf } from '@wordpress/i18n';
import { runCommand as runLoginCommand } from 'cli/commands/auth/login';
import { openBrowser } from 'cli/lib/browser';
import { input, password, select } from 'cli/lib/prompts';
import { recordTracksEvent } from 'cli/lib/tracks';
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

// What the provider says when it rejects the form's values, or `true` when it connects with them.
async function connectWith(
	provider: ProviderId,
	method: ConnectMethod,
	values: Record< string, string >
): Promise< string | true > {
	try {
		await changeAiSettings(
			{ action: 'connect', provider, method: method.id, surface: 'terminal' },
			() => connectProvider( getProviderServices( provider ), method.id, values ),
			recordTracksEvent
		);
		return true;
	} catch ( rejection ) {
		if ( rejection instanceof ConnectError ) {
			return rejection.message;
		}
		throw rejection;
	}
}

// Asks for one field, masked when it's a secret; `accept` can still refuse a valid answer.
function askField(
	field: FormField,
	message: string,
	accept: ( value: string ) => Promise< string | true > = async () => true
): Promise< string > {
	const prompt = field.secret ? password : input;
	return prompt( {
		message,
		...( field.secret ? { mask: '*' } : {} ),
		validate: async ( value: string ) => field.validate( value ) ?? accept( value ),
	} );
}

// Asks for a form's fields, of which an optional one takes an empty answer. The provider's
// rejection of a form of one field is that field's error, so it's asked again; a longer form is
// asked again whole, so any of its fields can be corrected.
async function fillForm( provider: ProviderId, method: ConnectMethod ): Promise< void > {
	const fields = method.kind === 'form' ? getFormFields( method.input() ) : [];
	for (;;) {
		const values: Record< string, string > = {};
		for ( const field of fields ) {
			values[ field.name ] = await askField(
				field,
				sprintf(
					field.required
						? /* translators: %s: what the provider asks for, such as an API key */
						  __( '%s (saved for future use):' )
						: /* translators: %s: what the provider asks for, such as an API key */
						  __( '%s (optional, saved for future use):' ),
					field.title
				),
				async ( value ) =>
					fields.length > 1 || connectWith( provider, method, { [ field.name ]: value } )
			);
		}
		if ( fields.length === 1 ) {
			return;
		}
		const rejection = await connectWith( provider, method, values );
		if ( rejection === true ) {
			return;
		}
		console.error( rejection );
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
		await changeAiSettings(
			{ action: 'connect', provider, method: method.id, surface: 'terminal' },
			() =>
				connectProvider( services, method.id, handoff, {
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
				} ),
			recordTracksEvent
		);
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
	if ( ! account ) {
		return;
	}
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

// Asks for the fields of a form a provider describes, such as a site to add.
export async function askFormFields( fields: FormField[] ): Promise< Record< string, string > > {
	const values: Record< string, string > = {};
	for ( const field of fields ) {
		values[ field.name ] = await askField(
			field,
			field.required
				? `${ field.title }:`
				: /* translators: %s: what the form asks for, such as a server address */
				  sprintf( __( '%s (optional):' ), field.title )
		);
	}
	return values;
}
