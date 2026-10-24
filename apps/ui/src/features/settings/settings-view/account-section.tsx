import { __ } from '@wordpress/i18n';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useOffline } from '@/lib/hooks';
import { Button } from '@/lib/ui';
import { SettingsGroup, SettingsRow } from './rows';

// Shown while signed out: connecting goes through WordPress.com sign-up.
export function ConnectionCard() {
	const { data: user, isSuccess } = useAuthUser();
	const signup = useLogin( { signup: true, source: 'settings' } );
	const isOffline = useOffline();
	if ( ! isSuccess || user ) {
		return null;
	}
	return (
		<SettingsGroup>
			<SettingsRow
				title={ __( 'Do more with WordPress.com' ) }
				description={ __(
					'Build with WordPress Studio, share local previews publicly, launch on WordPress.com, and keep sites in sync.'
				) }
				error={ signup.error?.message }
			>
				<Button
					disabled={ isOffline }
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
					loading={ logout.isPending }
					loadingAnnouncement={ __( 'Logging out' ) }
					onClick={ () => logout.mutate() }
				>
					{ __( 'Log out' ) }
				</Button>
			</SettingsRow>
		</SettingsGroup>
	);
}
