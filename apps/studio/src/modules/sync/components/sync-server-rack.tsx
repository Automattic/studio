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
	getSiteEnvironment,
	getEnvironmentLabel,
	EnvironmentType,
} from 'src/modules/sync/lib/environment-utils';
import { useAppDispatch } from 'src/stores';
import { syncOperationsThunks } from 'src/stores/sync';
import type { SyncSite } from 'src/modules/sync/types';

const ENVIRONMENT_ORDER: Record< EnvironmentType, number > = {
	development: 0,
	staging: 1,
	production: 2,
};

function sortByEnvironment( sites: SyncSite[] ): SyncSite[] {
	return [ ...sites ].sort( ( a, b ) => {
		const envA = getSiteEnvironment( a );
		const envB = getSiteEnvironment( b );
		return ENVIRONMENT_ORDER[ envA ] - ENVIRONMENT_ORDER[ envB ];
	} );
}

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
}: {
	connectedSites: SyncSite[];
	selectedSite: SiteDetails;
	disconnectSite: ( id: number ) => void;
} ) {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const { client } = useAuth();
	const [ syncDialogState, setSyncDialogState ] = useState< {
		type: 'push' | 'pull';
		remoteSite: SyncSite;
	} | null >( null );

	const sortedSites = sortByEnvironment( connectedSites );

	const localUrl = `localhost:${ selectedSite.port ?? '' }`;

	const isOffline = useOffline();

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

			{ /* Connected sites with push arrows */ }
			{ sortedSites.map( ( site, index ) => {
				const env = getSiteEnvironment( site );
				const envLabel = getEnvironmentLabel( env );
				const prevLabel =
					index === 0
						? __( 'Local' )
						: getEnvironmentLabel( getSiteEnvironment( sortedSites[ index - 1 ] ) );

				return (
					<div key={ site.id }>
						<PushArrow
							fromLabel={ prevLabel }
							toLabel={ envLabel }
							onClick={ () => setSyncDialogState( { type: 'push', remoteSite: site } ) }
						/>
						<SiteRack
							badge={ <EnvironmentBadge type={ env } /> }
							url={ site.url.replace( /^https?:\/\//, '' ) }
							onOpenUrl={ () => getIpcApi().openURL( site.url ) }
							variant={ env === 'staging' ? 'staging' : env === 'production' ? 'production' : 'default' }
							actions={
								<>
									<Button
										variant="secondary"
										onClick={ () => setSyncDialogState( { type: 'pull', remoteSite: site } ) }
										disabled={ isOffline }
									>
										{ __( 'Pull' ) }
									</Button>
									<Button
										variant="secondary"
										onClick={ () => setSyncDialogState( { type: 'push', remoteSite: site } ) }
										disabled={ isOffline }
									>
										{ __( 'Push' ) }
									</Button>
									<DropdownMenu icon={ moreVertical } label={ __( 'More actions' ) }>
										{ ( { onClose } ) => (
											<MenuGroup>
												<MenuItem
													onClick={ () => {
														onClose();
														void handleDisconnect( site );
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
					</div>
				);
			} ) }

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
