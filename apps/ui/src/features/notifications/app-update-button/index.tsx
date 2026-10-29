import { useMutation } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAppUpdateStatus } from '@/data/queries/use-app-update';
import { ImportIcon } from '@/lib/icons';
import { IconButton } from '@/lib/ui';

export function AppUpdateButton() {
	const connector = useConnector();
	const { data: status } = useAppUpdateStatus();
	const install = useMutation( {
		mutationFn: () => connector.installAppUpdate(),
		onError: ( error ) =>
			toast.error( __( 'Couldn’t update Studio' ), { description: error.message } ),
	} );

	if ( status?.state !== 'ready' ) return null;

	return (
		<IconButton
			variant="accent"
			icon={ <ImportIcon /> }
			label={ __( 'Update available' ) }
			onClick={ () => install.mutate() }
			disabled={ install.isPending }
		/>
	);
}
