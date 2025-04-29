import * as Sentry from '@sentry/electron/renderer';
import { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
import { z } from 'zod';
import { LIMIT_OF_PROMPTS_PER_USER } from 'src/constants';
import { useAuth } from 'src/hooks/use-auth';
import { useRootSelector } from 'src/stores';

const promptUsageSchema = z.object( {
	max_quota: z.number(),
	remaining_quota: z.number(),
	quota_reset_date: z.string(),
} );

type PromptUsage = {
	promptLimit: number;
	promptCount: number;
	fetchPromptUsage: () => Promise< void >;
	userCanSendMessage: boolean;
	daysUntilReset: number;
};

const initState: PromptUsage = {
	promptLimit: LIMIT_OF_PROMPTS_PER_USER,
	promptCount: 0,
	fetchPromptUsage: async () => undefined,
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

	const promptUsage = useRootSelector( ( state ) => state.chat.promptUsage );
	const [ promptLimit, setPromptLimit ] = useState( LIMIT_OF_PROMPTS_PER_USER );
	const [ promptCount, setPromptCount ] = useState( 0 );
	const [ quotaResetDate, setQuotaResetDate ] = useState( '' );
	const { client } = useAuth();

	const updatePromptUsage = useCallback(
		( maxQuota: string | number, remainingQuota: string | number ) => {
			const limit = parseInt( maxQuota as string );
			const remaining = parseInt( remainingQuota as string );
			if ( isNaN( limit ) || isNaN( remaining ) ) {
				return;
			}
			setPromptLimit( limit );
			setPromptCount( limit - remaining );
		},
		[]
	);

	const fetchPromptUsage = useCallback( async () => {
		if ( ! client?.req ) {
			return;
		}
		try {
			const response = await client.req.get( {
				path: '/studio-app/ai-assistant/quota',
				apiNamespace: 'wpcom/v2',
			} );
			const data = promptUsageSchema.parse( response );
			updatePromptUsage( data.max_quota, data.remaining_quota );
			setQuotaResetDate( data.quota_reset_date );
		} catch ( error ) {
			Sentry.captureException( error );
			console.error( error );
		}
	}, [ client, updatePromptUsage ] );

	useEffect( () => {
		if ( ! client ) {
			return;
		}
		void fetchPromptUsage();
	}, [ fetchPromptUsage, client ] );

	useEffect( () => {
		if ( promptUsage.maxQuota && promptUsage.remainingQuota ) {
			updatePromptUsage( promptUsage.maxQuota, promptUsage.remainingQuota );
		}
	}, [ promptUsage, updatePromptUsage ] );

	const daysUntilReset = useMemo(
		() => calculateDaysRemaining( quotaResetDate ),
		[ quotaResetDate ]
	);

	const contextValue = useMemo( () => {
		return {
			fetchPromptUsage,
			promptLimit,
			promptCount,
			userCanSendMessage: promptCount < promptLimit,
			daysUntilReset,
		};
	}, [ fetchPromptUsage, promptLimit, promptCount, daysUntilReset ] );

	return <Provider value={ contextValue }>{ children }</Provider>;
}
