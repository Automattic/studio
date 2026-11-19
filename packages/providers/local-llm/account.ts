import { __, sprintf } from '@wordpress/i18n';
import { ConnectError } from '../errors';
import { localLlmConnectInput } from './descriptor';
import { fetchChatModels, RefusedKeyError, toApiBase } from './server';
import type { LocalLlmConfig } from './config';
import type { ProviderServices } from '../types';

const getUnreachableMessage = ( address: string ) =>
	sprintf(
		/* translators: %s: the address of the user's model server, such as http://localhost:11434 */
		__( 'No local server answered at %s. Check the address, and that your server is running.' ),
		address
	);

export const getRefusedKeyMessage = () =>
	__( 'The local server refused the API key. Check the key, and connect again.' );

type LocalLlmAccount = ProviderServices< LocalLlmConfig >[ 'account' ];

// Connects when the server at the address offers a model to chat on, sending the key only when
// there is one, and offers all its chat models, those it says call tools first: new chats start on
// the first, and Ollama lists the model pulled last first, which may be one that can't.
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
		models: [
			...models.filter( ( { facts } ) => facts.tools ),
			...models.filter( ( { facts } ) => ! facts.tools ),
		].map( ( { id, facts } ) => ( { name: id, images: facts.images === true } ) ),
	};
};

export const localLlmAccount: LocalLlmAccount = { connect };
