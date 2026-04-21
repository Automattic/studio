import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import { Button, IconButton } from '@wordpress/ui';
import { getSiteUrl } from '@/lib/get-site-url';
import styles from './main-view.module.css';
import { PopoverRow } from './popover-row';
import { ensureProtocol, stripProtocol } from './utils';
import type { SiteStatus } from './dropdown-trigger';
import type { SiteDetails, Snapshot, SyncSite } from '@/data/core';

type Props = {
	site: SiteDetails;
	liveSite: SyncSite | undefined;
	previewSnapshot: Snapshot | undefined;
	status: SiteStatus;
	localSublabel: string;
	isStopping: boolean;
	isSyncing: boolean;
	isPreviewPending: boolean;
	isPushPending: boolean;
	isPullPending: boolean;
	onToggleServer: () => void;
	onOpenExternal: ( url: string ) => void;
	onPreviewClick: () => void;
	onPushClick: () => void;
	onPullClick: () => void;
	onSetupClick: () => void;
};

export function MainView( {
	site,
	liveSite,
	previewSnapshot,
	status,
	localSublabel,
	isStopping,
	isSyncing,
	isPreviewPending,
	isPushPending,
	isPullPending,
	onToggleServer,
	onOpenExternal,
	onPreviewClick,
	onPushClick,
	onPullClick,
	onSetupClick,
}: Props ) {
	return (
		<div className={ styles.rows }>
			<PopoverRow
				label={
					<>
						{ __( 'Local site' ) }
						{ site.running ? (
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ external }
								label={ __( 'Open local site' ) }
								onClick={ () => onOpenExternal( getSiteUrl( site ) ) }
							/>
						) : null }
					</>
				}
				sublabel={ localSublabel }
				action={
					<Button
						variant="minimal"
						tone="neutral"
						size="small"
						loading={ status === 'transitioning' }
						loadingAnnouncement={ isStopping ? __( 'Stopping' ) : __( 'Starting' ) }
						onClick={ onToggleServer }
					>
						{ site.running ? __( 'Stop' ) : __( 'Start' ) }
					</Button>
				}
			/>

			<PopoverRow
				label={
					<>
						{ __( 'Live site' ) }
						{ liveSite ? (
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ external }
								label={ __( 'Open live site' ) }
								onClick={ () => onOpenExternal( ensureProtocol( liveSite.url ) ) }
							/>
						) : null }
					</>
				}
				sublabel={ liveSite ? stripProtocol( liveSite.url ) : __( 'Not yet set up' ) }
				action={
					liveSite ? (
						<div className={ styles.rowActions }>
							<Button
								variant="minimal"
								tone="neutral"
								size="small"
								loading={ isPullPending }
								loadingAnnouncement={ __( 'Pulling from live' ) }
								disabled={ isSyncing }
								onClick={ onPullClick }
							>
								{ __( 'Pull' ) }
							</Button>
							<Button
								variant="minimal"
								tone="neutral"
								size="small"
								loading={ isPushPending }
								loadingAnnouncement={ __( 'Pushing to live' ) }
								disabled={ isSyncing }
								onClick={ onPushClick }
							>
								{ __( 'Push' ) }
							</Button>
						</div>
					) : (
						<Button
							variant="minimal"
							tone="neutral"
							size="small"
							disabled={ isSyncing }
							onClick={ onSetupClick }
						>
							{ __( 'Setup' ) }
						</Button>
					)
				}
			/>

			<PopoverRow
				label={
					<>
						{ __( 'Preview site' ) }
						{ previewSnapshot ? (
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ external }
								label={ __( 'Open preview site' ) }
								onClick={ () => onOpenExternal( ensureProtocol( previewSnapshot.url ) ) }
							/>
						) : null }
					</>
				}
				sublabel={
					previewSnapshot ? stripProtocol( previewSnapshot.url ) : __( 'Not yet created' )
				}
				action={
					<Button
						variant="minimal"
						tone="neutral"
						size="small"
						loading={ isPreviewPending }
						loadingAnnouncement={
							previewSnapshot ? __( 'Updating preview' ) : __( 'Creating preview' )
						}
						disabled={ isSyncing }
						onClick={ onPreviewClick }
					>
						{ previewSnapshot ? __( 'Update' ) : __( 'Preview' ) }
					</Button>
				}
			/>
		</div>
	);
}
