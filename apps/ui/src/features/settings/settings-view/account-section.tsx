import { __ } from '@wordpress/i18n';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useOffline } from '@/lib/hooks';
import { Button } from '@/lib/ui';
import { SettingsGroup, SettingsRow } from './rows';

// Shown while signed out: connecting goes through WordPress.com sign-up.
export function ConnectionCard() {
	const { data: user, isSuccess } = useAuthUser();
	const { promptRef, ...signup } = useLogin( {
		signup: true,
		source: 'settings',
		analytics: { placement: 'settings_account', intent: 'account' },
		trackExposure: isSuccess && ! user,
	} );
	const isOffline = useOffline();
	if ( ! isSuccess || user ) {
		return null;
	}
	return (
		<SettingsGroup>
			<SettingsRow
				title={ __( 'Do more with WordPress.com' ) }
				description={ __(
					'Create a free WordPress.com account to build with the agent, share previews, and publish.'
				) }
				error={ signup.error?.message }
			>
				<Button
					disabled={ isOffline }
					ref={ promptRef }
					loading={ signup.isPending }
					loadingAnnouncement={ __( 'Connecting' ) }
					onClick={ () => signup.mutate() }
				>
					{ __( 'Connect' ) }
				</Button>
			</SettingsRow>
		</SettingsGroup>
	);
}

export function AccountSection() {
	const { data: user } = useAuthUser();
	const logout = useLogout();
	if ( ! user ) {
		return <ConnectionCard />;
	}
	return (
		<SettingsGroup>
			<SettingsRow title={ user.displayName } description={ user.email }>
				<Button
					variant="outline"
					disabled={ logout.isPending }
					aria-busy={ logout.isPending || undefined }
					onClick={ () => logout.mutate() }
				>
					{ __( 'Log out' ) }
				</Button>
			</SettingsRow>
		</SettingsGroup>
	);
}
