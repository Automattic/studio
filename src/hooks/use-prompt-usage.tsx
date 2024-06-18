import * as Sentry from '@sentry/electron/renderer';
import { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
import { LIMIT_OF_PROMPTS_PER_USER } from '../constants';
import { getAppGlobals } from '../lib/app-globals';
import { useAuth } from './use-auth';

type PromptUsage = {
	promptLimit: number;
	promptCount: number;
	fetchPromptUsage: () => Promise< void >;
	updatePromptUsage: ( data: {
		maxQuota: string;
		remainingQuota: string;
		quotaResetDate: string;
	} ) => void;
	userCanSendMessage: boolean;
};

const initState = {
	promptLimit: LIMIT_OF_PROMPTS_PER_USER,
	promptCount: 0,
	fetchPromptUsage: async () => undefined,
	updatePromptUsage: ( _data: {
		maxQuota: string;
		remainingQuota: string;
		quotaResetDate: string;
	} ) => undefined,
	userCanSendMessage: true,
};
const promptUsageContext = createContext< PromptUsage >( initState );

interface PromptUsageProps {
	children?: React.ReactNode;
}

export function usePromptUsage() {
	return useContext( promptUsageContext );
}

export function PromptUsageProvider( { children }: PromptUsageProps ) {
	const { Provider } = promptUsageContext;
	const assistantEnabled = getAppGlobals().assistantEnabled;

	const [ initiated, setInitiated ] = useState( false );
	const [ promptLimit, setPromptLimit ] = useState( LIMIT_OF_PROMPTS_PER_USER );
	const [ promptCount, setPromptCount ] = useState( 0 );
	const { client } = useAuth();

	const updatePromptUsage = useCallback(
		( data: { maxQuota: string; remainingQuota: string; quotaResetDate: string } ) => {
			const limit = parseInt( data.maxQuota as string );
			const remaining = parseInt( data.remainingQuota as string );
			if ( isNaN( limit ) || isNaN( remaining ) ) {
				return;
			}
			setPromptLimit( limit );
			setPromptCount( limit - remaining );
			if ( ! initiated ) {
				setInitiated( true );
			}
		},
		[ initiated ]
	);

	const fetchPromptUsage = useCallback( async () => {
		if ( ! client?.req || ! assistantEnabled ) {
			return;
		}
		try {
			const response = await client.req.get( {
				method: 'GET',
				path: '/studio-app/ai-assistant/quota',
				apiNamespace: 'wpcom/v2',
			} );
			updatePromptUsage( {
				maxQuota: response.max_quota || '',
				remainingQuota: response.remaining_quota || '',
				quotaResetDate: response.quota_reset_date || '',
			} );
		} catch ( error ) {
			Sentry.captureException( error );
			console.error( error );
		}
	}, [ assistantEnabled, client, updatePromptUsage ] );

	useEffect( () => {
		if ( ! client || initiated ) {
			return;
		}
		fetchPromptUsage();
	}, [ fetchPromptUsage, client, initiated ] );

	const contextValue = useMemo( () => {
		return {
			fetchPromptUsage,
			promptLimit,
			promptCount,
			updatePromptUsage,
			userCanSendMessage: promptCount < promptLimit,
		};
	}, [ fetchPromptUsage, promptLimit, promptCount, updatePromptUsage ] );

	return <Provider value={ contextValue }>{ children }</Provider>;
}
