import { getProvider } from './registry';
import type { ConnectMethod, ProviderId } from './types';

// One field of a connection form, as a surface renders it.
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

// The provider's method with that id, or its first.
export function getConnectMethod( provider: ProviderId, id?: string ): ConnectMethod {
	const { methods } = getProvider( provider ).account;
	return methods.find( ( method ) => method.id === id ) ?? methods[ 0 ];
}

// The fields a method's form asks for; empty when it doesn't connect with a form.
export function getConnectFields( method: ConnectMethod ): ConnectField[] {
	if ( method.kind !== 'form' ) {
		return [];
	}
	return Object.entries( method.input().shape ).map( ( [ name, schema ] ) => {
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
