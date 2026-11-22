import { getProvider } from './registry';
import type { ConnectInputSchema, ConnectMethod, ProviderId } from './types';

// One field of a connection form, as a surface renders it.
export interface ConnectField {
	name: string;
	title: string;
	description?: string;
	placeholder?: string;
	// Never shown back: a password input, or a masked prompt.
	secret: boolean;
	// Whether it needs a value; one whose schema accepts an empty value may be left empty.
	required: boolean;
	// An error message for the value, or undefined when it is valid.
	validate( value: string ): string | undefined;
}

// The provider's method with that id, or its first.
export function getConnectMethod( provider: ProviderId, id?: string ): ConnectMethod {
	const methods = getProvider( provider ).account?.methods;
	if ( ! methods ) {
		throw new Error( `${ provider } has no account to connect` );
	}
	return methods.find( ( method ) => method.id === id ) ?? methods[ 0 ];
}

// Whether only a process on the user's computer can connect with the method: a sign-in that comes
// back to it or polls endpoints a browser can't call, or a method that says so.
export function needsHost( { kind, hostOnly }: ConnectMethod ): boolean {
	return kind === 'loopback' || kind === 'device' || hostOnly === true;
}

// The fields a method's form asks for; empty when it doesn't connect with a form.
export function getConnectFields( method: ConnectMethod ): ConnectField[] {
	return method.kind === 'form' ? getFormFields( method.input() ) : [];
}

// The fields of a form a provider describes, such as a connect method's or a site's to add.
export function getFormFields( input: ConnectInputSchema ): ConnectField[] {
	return Object.entries( input.shape ).map( ( [ name, schema ] ) => {
		const meta = schema.meta() ?? {};
		const examples = Array.isArray( meta.examples ) ? meta.examples : [];
		return {
			name,
			title: typeof meta.title === 'string' ? meta.title : name,
			description: typeof meta.description === 'string' ? meta.description : undefined,
			placeholder: typeof examples[ 0 ] === 'string' ? examples[ 0 ] : undefined,
			secret: meta.writeOnly === true,
			required: ! schema.safeParse( '' ).success,
			validate: ( value ) => {
				const result = schema.safeParse( value );
				return result.success ? undefined : result.error.issues[ 0 ]?.message;
			},
		};
	} );
}
