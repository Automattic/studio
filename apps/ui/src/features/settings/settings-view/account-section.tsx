import { __ } from '@wordpress/i18n';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { useOffline } from '@/lib/hooks';
import { Button } from '@/lib/ui';
import { SettingsGroup, SettingsRow } from './rows';

// Shown while signed out: connecting goes through WordPress.com sign-up.
export function ConnectionCard( { active = true }: { active?: boolean } ) {
	const { data: user, isSuccess } = useAuthUser();
	const { promptRef, ...signup } = useLogin( {
		signup: true,
		source: 'settings',
		analytics: { placement: 'settings_account', intent: 'account' },
		trackExposure: active && isSuccess && ! user,
	} );
	const isOffline = useOffline();
	if ( ! isSuccess || user ) {
		return null;
	}
	return (
		<SettingsGroup>
			<SettingsRow
				title={ __( 'Do more with WordPress' ) }
				description={ __(
					'Create a free WordPress.com account to build with the agent, share previews, and publish.'
				) }
				error={ signup.error?.message }
			>
				<Button
					variant="outline"
					disabled={ isOffline }
					ref={ promptRef }
					onClick={ () => signup.mutate() }
				>
					{ __( 'Connect' ) }
				</Button>
			</SettingsRow>
		</SettingsGroup>
	);
}
