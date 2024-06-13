import * as Sentry from '@sentry/electron/renderer';
import { useState, useCallback } from 'react';
import { getAppGlobals } from '../lib/app-globals';
import { useAuth } from './use-auth';

interface WelcomeMessageResponse {
	messages: string[];
	example_prompts: string[];
}

export const useFetchWelcomeMessages = () => {
	const { client } = useAuth();
	const [ messages, setMessages ] = useState< string[] >( [] );
	const [ examplePrompts, setExamplePrompts ] = useState< string[] >( [] );
	const locale = getAppGlobals().locale;

	const fetchWelcomeMessages = useCallback( async () => {
		if ( ! client?.req ) {
			return;
		}
		try {
			const response = await client.req.get( {
				path: '/studio-app/ai-assistant/welcome',
				apiNamespace: 'wpcom/v2',
				params: { locale },
			} );

			const data = response as WelcomeMessageResponse;

			if ( data ) {
				setMessages( data.messages || [] );
				setExamplePrompts( data.example_prompts || [] );
			}
		} catch ( error ) {
			Sentry.captureException( error );
			console.error( error );
		}
	}, [ client, locale ] );

	return { messages, examplePrompts, fetchWelcomeMessages };
};
