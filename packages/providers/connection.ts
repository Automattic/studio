import { getProviderDescriptor } from './descriptors';
import type { ProviderId, RedirectOptions } from './types';

// One field of a provider's connection form, as a surface renders it.
export interface ConnectField {
	name: string;
	title: string;
	description?: string;
	placeholder?: string;
	// Never shown back: a password input, or a masked prompt.
	secret: boolean;
	// An error message for the value, or undefined when it is valid.
	validate( value: string ): string | undefined;
}

// The fields a provider's form asks for; empty when it doesn't connect with a form.
export function getConnectFields( provider: ProviderId ): ConnectField[] {
	const { connection } = getProviderDescriptor( provider );
	if ( connection.kind !== 'form' ) {
		return [];
	}
	return Object.entries( connection.input().shape ).map( ( [ name, schema ] ) => {
		const meta = schema.meta() ?? {};
		const examples = Array.isArray( meta.examples ) ? meta.examples : [];
		return {
			name,
			title: typeof meta.title === 'string' ? meta.title : name,
			description: typeof meta.description === 'string' ? meta.description : undefined,
			placeholder: typeof examples[ 0 ] === 'string' ? examples[ 0 ] : undefined,
			secret: meta.writeOnly === true,
			validate: ( value ) => {
				const result = schema.safeParse( value );
				return result.success ? undefined : result.error.issues[ 0 ]?.message;
			},
		};
	} );
}

// Where to send the user to approve access, for a provider that connects with a redirect.
export function getRedirectUrl( provider: ProviderId, options: RedirectOptions ): string {
	const { connection } = getProviderDescriptor( provider );
	if ( connection.kind !== 'redirect' ) {
		throw new Error( `${ provider } does not connect with a redirect` );
	}
	return connection.redirectUrl( options );
}
