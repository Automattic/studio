import * as Sentry from '@sentry/electron/renderer';
import { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
import { LIMIT_OF_PROMPTS_PER_USER } from '../constants';
import { useAuth } from './use-auth';
import { useFeatureFlags } from './use-feature-flags';

type PromptUsage = {
	promptLimit: number;
	promptCount: number;
	fetchPromptUsage: () => Promise< void >;
	updatePromptUsage: ( data: { maxQuota: string; remainingQuota: string } ) => void;
	userCanSendMessage: boolean;
	daysUntilReset: number;
};

const initState: PromptUsage = {
	promptLimit: LIMIT_OF_PROMPTS_PER_USER,
	promptCount: 0,
	fetchPromptUsage: async () => undefined,
	updatePromptUsage: ( _data: { maxQuota: string; remainingQuota: string } ) => undefined,
	userCanSendMessage: true,
	daysUntilReset: 0,
};

const promptUsageContext = createContext< PromptUsage >( initState );

interface PromptUsageProps {
	children?: React.ReactNode;
}

export function usePromptUsage() {
	return useContext( promptUsageContext );
}

const calculateDaysRemaining = ( quotaResetDate: string ): number => {
	const resetDate = new Date( quotaResetDate );
	const currentDate = new Date();
	const timeDifference = resetDate.getTime() - currentDate.getTime();
	const daysDifference = Math.ceil( timeDifference / ( 1000 * 3600 * 24 ) );
	return daysDifference;
};

export function PromptUsageProvider( { children }: PromptUsageProps ) {
	const { Provider } = promptUsageContext;
	const { assistantEnabled } = useFeatureFlags();

	const [ promptLimit, setPromptLimit ] = useState( LIMIT_OF_PROMPTS_PER_USER );
	const [ promptCount, setPromptCount ] = useState( 0 );
	const [ quotaResetDate, setQuotaResetDate ] = useState( '' );
	const { client } = useAuth();

	const updatePromptUsage = useCallback( ( data: { maxQuota: string; remainingQuota: string } ) => {
		const limit = parseInt( data.maxQuota as string );
		const remaining = parseInt( data.remainingQuota as string );
		if ( isNaN( limit ) || isNaN( remaining ) ) {
			return;
		}
		setPromptLimit( limit );
		setPromptCount( limit - remaining );
	}, [] );

	const fetchPromptUsage = useCallback( async () => {
		if ( ! client?.req || ! assistantEnabled ) {
			return;
		}
		try {
			const response = await client.req.get( {
				path: '/studio-app/ai-assistant/quota',
				apiNamespace: 'wpcom/v2',
			} );
			updatePromptUsage( {
				maxQuota: response.max_quota || '',
				remainingQuota: response.remaining_quota || '',
			} );
			setQuotaResetDate( response.quota_reset_date || '' );
		} catch ( error ) {
			Sentry.captureException( error );
			console.error( error );
		}
	}, [ assistantEnabled, client, updatePromptUsage ] );

	useEffect( () => {
		if ( ! client ) {
			return;
		}
		fetchPromptUsage();
	}, [ fetchPromptUsage, client ] );

	const daysUntilReset = useMemo(
		() => calculateDaysRemaining( quotaResetDate ),
		[ quotaResetDate ]
	);

	const contextValue = useMemo( () => {
		return {
			fetchPromptUsage,
			promptLimit,
			promptCount,
			updatePromptUsage,
			userCanSendMessage: promptCount < promptLimit,
			daysUntilReset,
		};
	}, [ fetchPromptUsage, promptLimit, promptCount, updatePromptUsage, daysUntilReset ] );

	return <Provider value={ contextValue }>{ children }</Provider>;
}
