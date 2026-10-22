import { __ } from '@wordpress/i18n';
import { Button } from '@/components/ui/button';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useOffline } from '@/hooks/use-offline';
import { SettingsGroup, SettingsRow } from './rows';

export function AccountSection() {
	const { data: user, isLoading } = useAuthUser();
	const login = useLogin( { source: 'settings' } );
	const logout = useLogout();
	const isOffline = useOffline();

	return (
		<SettingsGroup>
			<SettingsRow
				title={ user ? user.displayName : __( 'WordPress.com account' ) }
				description={
					user
						? user.email
						: __( 'Log in to use AI features and synchronize with live and preview sites.' )
				}
			>
				{ user ? (
					<Button
						loading={ logout.isPending }
						loadingAnnouncement={ __( 'Logging out' ) }
						onClick={ () => logout.mutate() }
					>
						{ __( 'Log out' ) }
					</Button>
				) : (
					<Button
						disabled={ isLoading || isOffline }
						loading={ login.isPending }
						loadingAnnouncement={ __( 'Logging in' ) }
						onClick={ () => login.mutate() }
					>
						{ __( 'Log in' ) }
					</Button>
				) }
			</SettingsRow>
		</SettingsGroup>
	);
}
