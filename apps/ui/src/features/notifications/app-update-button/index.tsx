import { useMutation } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAppUpdateStatus, useRetryAppUpdate } from '@/data/queries/use-app-update';
import { ImportIcon } from '@/lib/icons';
import { IconButton } from '@/lib/ui';

export function AppUpdateButton( { className }: { className?: string } ) {
	const connector = useConnector();
	const { data: status } = useAppUpdateStatus();
	const retry = useRetryAppUpdate();
	const install = useMutation( {
		mutationFn: () => connector.installAppUpdate(),
		onError: ( error ) =>
			toast.error( __( 'Couldn’t update Studio' ), { description: error.message } ),
	} );

	if ( ! status || status.state === 'idle' ) return null;

	const checking = status.state === 'checking' || retry.isPending;
	const downloading = status.state === 'downloading';
	const failed = status.state === 'error';
	const label = checking
		? __( 'Checking for updates…' )
		: downloading
		? __( 'Downloading update…' )
		: failed
		? __( 'Download update' )
		: install.isPending
		? __( 'Restarting…' )
		: __( 'Restart to update' );

	return (
		<IconButton
			className={ className }
			size="icon-sm"
			variant="accent"
			icon={ <ImportIcon /> }
			label={ label }
			loading={ checking || downloading || install.isPending }
			loadingMode="replace"
			onClick={ () => {
				if ( failed ) retry.mutate();
				else if ( status.state === 'ready' ) install.mutate();
			} }
		/>
	);
}
