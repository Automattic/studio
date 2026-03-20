import { DropdownMenu, MenuGroup, MenuItem } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { moreVertical } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { WordPressLogoCircle } from 'src/components/wordpress-logo-circle';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { EnvironmentBadge } from 'src/modules/sync/components/environment-badge';
import { SyncDialog } from 'src/modules/sync/components/sync-dialog';
import {
	convertTreeToPullOptions,
	convertTreeToPushOptions,
} from 'src/modules/sync/lib/convert-tree-to-sync-options';
import {
	getSlotForSite,
	getEnvironmentLabel,
	type SlotType,
} from 'src/modules/sync/lib/environment-utils';
import { useAppDispatch } from 'src/stores';
import { syncOperationsThunks } from 'src/stores/sync';
import type { SyncSite } from 'src/modules/sync/types';

function SiteRack( {
	badge,
	url,
	onOpenUrl,
	actions,
	className,
	variant,
}: {
	badge: React.ReactNode;
	url: string;
	onOpenUrl: () => void;
	actions?: React.ReactNode;
	className?: string;
	variant?: 'default' | 'staging' | 'production';
} ) {
	const variantClasses = {
		default: 'border-frame-border bg-frame',
		staging: 'border-[#93590c]/25 bg-[#fef0c7]/20',
		production: 'border-[#1a6928]/25 bg-[#ceead6]/20',
	};

	return (
		<div
			className={ cx(
				'flex items-center gap-3 px-5 py-4 border rounded-lg min-h-[60px]',
				variantClasses[ variant ?? 'default' ],
				className
			) }
		>
			{ badge }
			<div className="flex items-center gap-1.5 min-w-0">
				<WordPressLogoCircle />
				<Button
					variant="link"
					className="!text-frame-text hover:!text-frame-theme min-w-0"
					onClick={ onOpenUrl }
				>
					<span className="truncate">{ url }</span>
					<ArrowIcon />
				</Button>
			</div>
			{ actions && <div className="ml-auto shrink-0 flex gap-2">{ actions }</div> }
		</div>
	);
}

function EmptySlot( {
	slot,
	onConnect,
}: {
	slot: SlotType;
	onConnect: ( slot: SlotType ) => void;
} ) {
	const { __ } = useI18n();
	const isOffline = useOffline();

	const variantClasses = {
		staging: 'border-[#93590c]/25',
		production: 'border-[#1a6928]/25',
	};

	const label = slot === 'staging' ? __( 'Staging' ) : __( 'Production' );

	return (
		<div
			className={ cx(
				'flex items-center gap-3 px-5 py-4 border border-dashed rounded-lg min-h-[60px]',
				variantClasses[ slot ]
			) }
		>
			<EnvironmentBadge type={ slot } />
			<span className="text-frame-text-secondary a8c-body">
				{ sprintf(
					// translators: %s is the environment type (Staging or Production)
					__( 'No %s site connected' ),
					label.toLowerCase()
				) }
			</span>
			<div className="ml-auto shrink-0">
				<Button variant="secondary" onClick={ () => onConnect( slot ) } disabled={ isOffline }>
					{ __( 'Connect' ) }
				</Button>
			</div>
		</div>
	);
}

function FilledSlot( {
	site,
	slot,
	onPull,
	onPush,
	onReplace,
	onDisconnect,
}: {
	site: SyncSite;
	slot: SlotType;
	onPull: () => void;
	onPush: () => void;
	onReplace: ( slot: SlotType ) => void;
	onDisconnect: ( site: SyncSite ) => void;
} ) {
	const { __ } = useI18n();
	const isOffline = useOffline();

	return (
		<SiteRack
			badge={ <EnvironmentBadge type={ slot } /> }
			url={ site.url.replace( /^https?:\/\//, '' ) }
			onOpenUrl={ () => getIpcApi().openURL( site.url ) }
			variant={ slot === 'staging' ? 'staging' : 'production' }
			actions={
				<>
					<Button
						variant="secondary"
						onClick={ onPull }
						disabled={ isOffline }
						data-testid="sync-list-pull-button"
					>
						{ __( 'Pull' ) }
					</Button>
					<Button
						variant="secondary"
						onClick={ onPush }
						disabled={ isOffline }
						data-testid="sync-list-push-button"
					>
						{ __( 'Push' ) }
					</Button>
					<DropdownMenu icon={ moreVertical } label={ __( 'More actions' ) }>
						{ ( { onClose } ) => (
							<MenuGroup>
								<MenuItem
									onClick={ () => {
										onClose();
										onReplace( slot );
									} }
								>
									{ __( 'Replace' ) }
								</MenuItem>
								<MenuItem
									onClick={ () => {
										onClose();
										void onDisconnect( site );
									} }
									className="!text-a8c-red-50"
								>
									{ __( 'Disconnect' ) }
								</MenuItem>
							</MenuGroup>
						) }
					</DropdownMenu>
				</>
			}
		/>
	);
}

function PushArrow( {
	fromLabel,
	toLabel,
	onClick,
}: {
	fromLabel: string;
	toLabel: string;
	onClick: () => void;
} ) {
	const { __ } = useI18n();
	const isOffline = useOffline();
	const label = sprintf(
		// translators: %1$s is the source environment, %2$s is the destination environment
		__( 'Push %1$s to %2$s' ),
		fromLabel,
		toLabel
	);

	return (
		<div className="flex flex-col items-center py-3">
			<div className="w-px h-3 bg-frame-border" />
			<Button
				variant="link"
				className="!text-xs !text-frame-text-secondary hover:!text-frame-theme !no-underline"
				onClick={ onClick }
				disabled={ isOffline }
			>
				{ label }
			</Button>
			<div className="w-px h-3 bg-frame-border" />
			<svg width="10" height="6" viewBox="0 0 10 6" className="text-frame-border">
				<path d="M5 6L0 0h10L5 6z" fill="currentColor" />
			</svg>
		</div>
	);
}

export function SyncServerRack( {
	connectedSites,
	selectedSite,
	disconnectSite,
	onConnectSlot,
	onReplaceSlot,
}: {
	connectedSites: SyncSite[];
	selectedSite: SiteDetails;
	disconnectSite: ( id: number ) => void;
	onConnectSlot: ( slot: SlotType ) => void;
	onReplaceSlot: ( slot: SlotType ) => void;
} ) {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const { client } = useAuth();
	const [ syncDialogState, setSyncDialogState ] = useState< {
		type: 'push' | 'pull';
		remoteSite: SyncSite;
	} | null >( null );

	const stagingSite = connectedSites.find( ( s ) => getSlotForSite( s ) === 'staging' );
	const productionSite = connectedSites.find( ( s ) => getSlotForSite( s ) === 'production' );

	const localUrl = `localhost:${ selectedSite.port ?? '' }`;

	const handleDisconnect = async ( site: SyncSite ) => {
		const dontShowDisconnectWarning = localStorage.getItem( 'dontShowDisconnectWarning' );
		if ( ! dontShowDisconnectWarning ) {
			const disconnectMessage = site.name
				? sprintf( __( 'Disconnect %s' ), site.name )
				: __( 'Disconnect site' );

			const { response, checkboxChecked } = await getIpcApi().showMessageBox( {
				message: disconnectMessage,
				detail: __(
					'Your WordPress.com site will not be affected by disconnecting it from Studio.'
				),
				buttons: [ __( 'Disconnect' ), __( 'Cancel' ) ],
				cancelId: 1,
				checkboxLabel: __( "Don't ask again" ),
			} );

			if ( response === 0 ) {
				if ( checkboxChecked ) {
					localStorage.setItem( 'dontShowDisconnectWarning', 'true' );
				}
				disconnectSite( site.id );
			}
		} else {
			disconnectSite( site.id );
		}
	};

	return (
		<div className="flex flex-col items-stretch p-8 max-w-2xl">
			{ /* Local site rack */ }
			<SiteRack
				badge={
					<span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-frame-surface text-frame-text-secondary border border-frame-border">
						{ __( 'Local' ) }
					</span>
				}
				url={ localUrl }
				onOpenUrl={ () => getIpcApi().openSiteURL( selectedSite.id ) }
			/>

			{ /* Staging slot */ }
			{ stagingSite ? (
				<>
					<PushArrow
						fromLabel={ __( 'Local' ) }
						toLabel={ getEnvironmentLabel( 'staging' ) }
						onClick={ () => setSyncDialogState( { type: 'push', remoteSite: stagingSite } ) }
					/>
					<FilledSlot
						site={ stagingSite }
						slot="staging"
						onPull={ () => setSyncDialogState( { type: 'pull', remoteSite: stagingSite } ) }
						onPush={ () => setSyncDialogState( { type: 'push', remoteSite: stagingSite } ) }
						onReplace={ onReplaceSlot }
						onDisconnect={ handleDisconnect }
					/>
				</>
			) : (
				<>
					<div className="flex flex-col items-center py-3">
						<div className="w-px h-6 bg-frame-border" />
					</div>
					<EmptySlot slot="staging" onConnect={ onConnectSlot } />
				</>
			) }

			{ /* Production slot */ }
			{ productionSite ? (
				<>
					<PushArrow
						fromLabel={ stagingSite ? getEnvironmentLabel( 'staging' ) : __( 'Local' ) }
						toLabel={ getEnvironmentLabel( 'production' ) }
						onClick={ () => setSyncDialogState( { type: 'push', remoteSite: productionSite } ) }
					/>
					<FilledSlot
						site={ productionSite }
						slot="production"
						onPull={ () => setSyncDialogState( { type: 'pull', remoteSite: productionSite } ) }
						onPush={ () => setSyncDialogState( { type: 'push', remoteSite: productionSite } ) }
						onReplace={ onReplaceSlot }
						onDisconnect={ handleDisconnect }
					/>
				</>
			) : (
				<>
					<div className="flex flex-col items-center py-3">
						<div className="w-px h-6 bg-frame-border" />
					</div>
					<EmptySlot slot="production" onConnect={ onConnectSlot } />
				</>
			) }

			{ syncDialogState && (
				<SyncDialog
					type={ syncDialogState.type }
					localSite={ selectedSite }
					remoteSite={ syncDialogState.remoteSite }
					onPush={ ( tree ) => {
						const pushOptions = convertTreeToPushOptions( tree );
						void dispatch(
							syncOperationsThunks.pushSite( {
								connectedSite: syncDialogState.remoteSite,
								selectedSite,
								options: pushOptions,
							} )
						);
					} }
					onPull={ ( tree ) => {
						if ( ! client ) {
							return;
						}
						const pullOptions = convertTreeToPullOptions( tree );
						void dispatch(
							syncOperationsThunks.pullSite( {
								client,
								connectedSite: syncDialogState.remoteSite,
								selectedSite,
								options: pullOptions,
							} )
						);
					} }
					onRequestClose={ () => setSyncDialogState( null ) }
				/>
			) }
		</div>
	);
}
