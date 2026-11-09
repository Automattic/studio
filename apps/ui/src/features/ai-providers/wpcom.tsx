import { __ } from '@wordpress/i18n';
import { useEffect, useState } from 'react';
import { getProviderIntent } from '@/data/account-analytics';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { LearnMoreLink } from '@/features/onboarding';
import { useOffline } from '@/lib/hooks';
import { WordPressIcon } from '@/lib/icons';
import { Button } from '@/lib/ui';
import type { ProviderConnectionProps } from './types';

function WordPressComConnection( {
	Row: SettingsRow,
	connectedBadge,
	onSelect,
	onManageCredits,
}: ProviderConnectionProps ) {
	const { data: user, isLoading: userLoading } = useAuthUser();
	const origin = getProviderIntent( useConnector() );
	const { promptRef, ...signup } = useLogin( {
		signup: true,
		source: 'settings',
		analytics: {
			placement: 'settings_ai',
			intent: origin?.intent ?? 'build',
			journey_id: origin?.journey_id,
		},
		scope: origin?.scope,
		trackExposure: ! user && ! userLoading,
	} );
	const isOffline = useOffline();
	const [ wpcomRequested, setWpcomRequested ] = useState( false );
	useEffect( () => {
		if ( wpcomRequested && user ) {
			setWpcomRequested( false );
			void onSelect().catch( () => {} );
		}
	}, [ wpcomRequested, user, onSelect ] );

	return (
		<SettingsRow
			title={ __( 'WordPress.com' ) }
			badge={ user ? connectedBadge : null }
			description={
				<>
					{ __(
						'Get started with a one-time free allowance, then buy more as you go. No API key required.'
					) }{ ' ' }
					<LearnMoreLink docsLinksKey="docsAiCredits" />
				</>
			}
			error={ signup.error?.message }
		>
			<Button
				disabled={ userLoading || ( ! user && isOffline ) }
				ref={ promptRef }
				onClick={ () => {
					if ( user ) {
						onManageCredits();
						return;
					}
					setWpcomRequested( true );
					signup.mutate( undefined, { onError: () => setWpcomRequested( false ) } );
				} }
			>
				{ user ? __( 'Manage' ) : __( 'Connect' ) }
			</Button>
		</SettingsRow>
	);
}

export const wpcomUiProvider = { icon: WordPressIcon, Connection: WordPressComConnection };
