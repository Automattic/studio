import { useMutation } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAppUpdateStatus, useRetryAppUpdate } from '@/data/queries/use-app-update';
import { UpdateIcon } from '@/lib/icons';
import { Button, IconButton, Menu } from '@/lib/ui';
import styles from './style.module.css';

export function AppUpdateButton( {
	className,
	placement = 'sidebar',
}: {
	className?: string;
	placement?: 'sidebar' | 'menu';
} ) {
	const connector = useConnector();
	const { data: status } = useAppUpdateStatus();
	const retry = useRetryAppUpdate();
	const install = useMutation( {
		mutationFn: () => connector.installAppUpdate(),
		onError: ( error ) =>
			toast.error( __( 'Couldn’t update Studio' ), { description: error.message } ),
	} );

	if ( ! status || status.state === 'idle' ) return null;
	if ( placement === 'menu' ) {
		if ( status.state !== 'ready' ) return null;
		return (
			<Menu.Item
				className={ styles.update }
				closeOnClick={ false }
				disabled={ install.isPending }
				onClick={ () => install.mutate() }
			>
				<span>{ __( 'Update available' ) }</span>
				<Button
					render={ <span /> }
					nativeButton={ false }
					role="presentation"
					tabIndex={ -1 }
					variant="accent"
					size="sm"
					className={ styles.action }
				>
					{ install.isPending ? __( 'Updating…' ) : __( 'Update' ) }
				</Button>
			</Menu.Item>
		);
	}

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
		? __( 'Updating…' )
		: __( 'Update available' );

	return (
		<IconButton
			className={ className }
			size="icon-sm"
			variant="accent"
			icon={ <UpdateIcon /> }
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
