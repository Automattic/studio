import { getProviderDescriptor } from './descriptors';
import type {
	ConnectionMethod,
	ConnectStep,
	ProviderConnection,
	ProviderId,
	RedirectOptions,
} from './types';

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

// The ways a provider's account connects, for the user to pick; empty when it has only one.
export function getConnectionMethods( provider: ProviderId ): ConnectionMethod[] {
	const { connection } = getProviderDescriptor( provider );
	return Array.isArray( connection ) ? connection : [];
}

// How the account connects with `method`, or with the provider's first method.
export function getConnection( provider: ProviderId, method?: string ): ProviderConnection {
	const { connection } = getProviderDescriptor( provider );
	if ( ! Array.isArray( connection ) ) {
		return connection;
	}
	return connection.find( ( { id } ) => id === method ) ?? connection[ 0 ];
}

// The method a config was connected with, for a provider with several.
export function getConnectedMethod( provider: ProviderId, config: unknown ): string | undefined {
	const method = ( config as { method?: unknown } | undefined )?.method;
	return getConnectionMethods( provider ).find( ( { id } ) => id === method )?.id;
}

// What the user does before filling the provider's form in.
export function getConnectSteps( provider: ProviderId, method?: string ): ConnectStep[] {
	const connection = getConnection( provider, method );
	return ( connection.kind === 'form' && connection.steps?.() ) || [];
}

// The fields a provider's form asks for; empty when it doesn't connect with a form.
export function getConnectFields( provider: ProviderId, method?: string ): ConnectField[] {
	const connection = getConnection( provider, method );
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
	const connection = getConnection( provider );
	if ( connection.kind !== 'redirect' ) {
		throw new Error( `${ provider } does not connect with a redirect` );
	}
	return connection.redirectUrl( options );
}
