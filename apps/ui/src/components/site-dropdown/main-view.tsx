import { __ } from '@wordpress/i18n';
import { arrowDown, external } from '@wordpress/icons';
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
	onPullClick: () => void;
	onPublishClick: () => void;
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
	onPullClick,
	onPublishClick,
}: Props ) {
	return (
		<>
			<div className={ styles.rows }>
				<PopoverRow
					label={ __( 'Local site' ) }
					sublabel={ localSublabel }
					action={
						<div className={ styles.rowActions }>
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
						</div>
					}
				/>

				<PopoverRow
					label={ __( 'Live site' ) }
					sublabel={ liveSite ? stripProtocol( liveSite.url ) : __( 'Not yet published' ) }
					action={
						liveSite ? (
							<div className={ styles.rowActions }>
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ arrowDown }
									label={ __( 'Pull from live' ) }
									loading={ isPullPending }
									loadingAnnouncement={ __( 'Pulling from live' ) }
									disabled={ isSyncing }
									onClick={ onPullClick }
								/>
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ external }
									label={ __( 'Open live site' ) }
									onClick={ () => onOpenExternal( ensureProtocol( liveSite.url ) ) }
								/>
							</div>
						) : null
					}
				/>

				{ previewSnapshot ? (
					<PopoverRow
						label={ __( 'Preview site' ) }
						sublabel={ stripProtocol( previewSnapshot.url ) }
						action={
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ external }
								label={ __( 'Open preview site' ) }
								onClick={ () => onOpenExternal( ensureProtocol( previewSnapshot.url ) ) }
							/>
						}
					/>
				) : null }
			</div>

			<div className={ styles.footer }>
				<Button
					variant="outline"
					tone="neutral"
					size="compact"
					className={ styles.footerButton }
					loading={ isPreviewPending }
					loadingAnnouncement={
						previewSnapshot ? __( 'Updating preview…' ) : __( 'Creating preview…' )
					}
					disabled={ isSyncing }
					onClick={ onPreviewClick }
				>
					{ previewSnapshot ? __( 'Update preview' ) : __( 'Preview' ) }
				</Button>
				<Button
					variant="solid"
					tone="brand"
					size="compact"
					className={ styles.footerButton }
					loading={ isPushPending }
					loadingAnnouncement={ __( 'Publishing…' ) }
					disabled={ isSyncing }
					onClick={ onPublishClick }
				>
					{ liveSite ? __( 'Publish' ) : __( 'Publish…' ) }
				</Button>
			</div>
		</>
	);
}
