import { getProvider } from '@studio/providers';
import { __ } from '@wordpress/i18n';
import { useAiSettings, useDisconnectProvider } from '@/data/queries/use-ai-settings';
import { useOffline } from '@/lib/hooks';
import { Button } from '@/lib/ui';
import { ProviderLogo } from './provider-logo';
import { connectedBadge, SettingsRow } from './rows';

export type SpacefastConnectControl = {
	isPending: boolean;
	onConnect: () => void;
};

export function SpacefastProviderRow( { isPending, onConnect }: SpacefastConnectControl ) {
	const settings = useAiSettings();
	const disconnect = useDisconnectProvider( 'spacefast' );
	const offline = useOffline();
	const descriptor = getProvider( 'spacefast' );
	const connected = settings.data?.accounts.spacefast.connected;

	return (
		<SettingsRow
			title={ descriptor.label }
			settingId="spacefast-provider"
			icon={ <ProviderLogo provider="spacefast" /> }
			badge={ connected ? connectedBadge() : null }
			description={ descriptor.description?.() }
			error={ disconnect.error?.message }
		>
			<Button
				variant="outline"
				aria-haspopup={ connected ? undefined : 'dialog' }
				disabled={
					settings.isLoading || disconnect.isPending || ( ! connected && ! isPending && offline )
				}
				onClick={ connected ? () => disconnect.mutate() : onConnect }
			>
				{ connected ? __( 'Disconnect' ) : __( 'Connect' ) }
			</Button>
		</SettingsRow>
	);
}
