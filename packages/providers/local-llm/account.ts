import { __, sprintf } from '@wordpress/i18n';
import { ConnectError } from '../errors';
import { toConfigModels, type LocalLlmConfig } from './config';
import { localLlmConnectInput } from './descriptor';
import { fetchChatModels, RefusedKeyError, toApiBase } from './server';
import type { AccountServices } from '../types';

const getUnreachableMessage = ( address: string ) =>
	sprintf(
		/* translators: %s: the address of the user's model server, such as http://localhost:11434 */
		__( 'No local server answered at %s. Check the address, and that your server is running.' ),
		address
	);

export const getRefusedKeyMessage = () =>
	__( 'The local server refused the API key. Check the key, and connect again.' );

type LocalLlmAccount = AccountServices< LocalLlmConfig >;

// Connects when the server at the address offers a model to chat on, sending the key only when
// there is one, and offers all its chat models.
const connect: LocalLlmAccount[ 'connect' ] = async ( _method, input ) => {
	const parsed = localLlmConnectInput().safeParse( input );
	if ( ! parsed.success ) {
		throw new ConnectError( parsed.error.issues[ 0 ].message );
	}
	const { address, apiKey: key } = parsed.data;
	const apiKey = key || undefined;
	const baseUrl = toApiBase( address );
	if ( ! baseUrl ) {
		throw new ConnectError( getUnreachableMessage( address ) );
	}
	const models = await fetchChatModels( baseUrl, apiKey ).catch( ( error ) => {
		throw new ConnectError(
			error instanceof RefusedKeyError ? getRefusedKeyMessage() : getUnreachableMessage( address )
		);
	} );
	if ( ! models.length ) {
		throw new ConnectError(
			__( 'The local server has no chat model yet. Add one to your server, then connect again.' )
		);
	}
	return {
		method: 'server',
		baseUrl,
		...( apiKey ? { apiKey } : {} ),
		models: toConfigModels(
			models.map( ( { id, facts } ) => ( {
				name: id,
				images: facts.images === true,
				tools: facts.tools,
			} ) )
		),
	};
};

export const localLlmAccount: LocalLlmAccount = { connect };
