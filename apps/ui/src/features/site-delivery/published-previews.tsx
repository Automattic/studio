import { __, sprintf } from '@wordpress/i18n';
import { useRef, type ReactNode } from 'react';
import { useConnector } from '@/data/core';
import { useCopyText } from '@/data/host/use-copy-text';
import { getSnapshotHostname, getSnapshotUrl } from '@/data/snapshot-url';
import { EllipsisVerticalIcon, ExternalLinkIcon, LinkIcon, PlusIcon } from '@/lib/icons';
import { Button, IconButton, Menu, Skeleton } from '@/lib/ui';
import { DestinationRow } from './destination-row';
import styles from './style.module.css';
import { describePublishTarget } from './target-description';
import { TargetSwitcher } from './target-switcher';
import type { usePublishPreview } from './use-publish-preview';
import type { PublishTarget, usePublishTargets } from './use-publish-targets';

export function PublishedPreviews( {
	targets,
	preview,
	creating,
	disabled,
	locale,
	onNewPreview,
	newPreviewDisabled,
	onSelect,
	renderActions,
}: {
	targets: ReturnType< typeof usePublishTargets >;
	preview: ReturnType< typeof usePublishPreview >;
	creating: boolean;
	disabled: boolean;
	locale?: string;
	onNewPreview: () => void;
	newPreviewDisabled: boolean;
	onSelect: ( target: PublishTarget ) => void;
	renderActions: ( target: PublishTarget ) => ReactNode;
} ) {
	const connector = useConnector();
	const row = useRef< HTMLButtonElement >( null );
	const target = targets.selectedPreview;
	const snapshot = target?.snapshot;
	const url = snapshot ? getSnapshotUrl( snapshot ) : '';
	const hostname = snapshot ? getSnapshotHostname( snapshot ) : '';
	const { copied, copy } = useCopyText( url );
	const current = preview.status.data?.localChanged === false;
	const updating = preview.pending && ! creating;
	return (
		<section aria-label={ __( 'Previews' ) } className={ styles.publishedPreviews }>
			<div className={ styles.destinationRow }>
				<h3 className={ styles.destinationLabel }>{ __( 'Previews' ) }</h3>
				{ target && (
					<Menu.Root>
						<Menu.Trigger
							render={
								<IconButton
									variant="muted-ghost"
									size="icon-sm"
									label={ __( 'Preview options' ) }
									icon={ <EllipsisVerticalIcon /> }
								/>
							}
						/>
						<Menu.Popup align="end" aria-label={ __( 'Preview actions' ) }>
							<Menu.Item disabled={ newPreviewDisabled } onClick={ onNewPreview }>
								<PlusIcon />
								{ __( 'New preview' ) }
							</Menu.Item>
							<Menu.Separator />
							{ renderActions( target ) }
						</Menu.Popup>
					</Menu.Root>
				) }
			</div>
			{ target && ( targets.previewTargets.length > 1 || creating ) && (
				<div className={ styles.settingsGroup }>
					{ creating ? (
						<Button
							variant="ghost"
							className={ styles.accessTrigger }
							disabled
							aria-label={ __( 'Choose preview' ) }
							aria-busy="true"
						>
							<Skeleton className={ styles.previewSkeletonIcon } />
							<span className={ styles.accessTriggerLabel }>
								<Skeleton className={ styles.previewSkeletonTitle } />
							</span>
							<Skeleton className={ styles.previewSkeletonIcon } />
						</Button>
					) : (
						<TargetSwitcher
							previewsOnly
							targets={ targets.previewTargets }
							selectedKey={ target.key }
							hostname={ hostname }
							locale={ locale }
							disabled={ disabled }
							onSelect={ onSelect }
							onNewPreview={ onNewPreview }
							newPreviewDisabled={ newPreviewDisabled }
						/>
					) }
				</div>
			) }
			<div className={ styles.settingsGroup }>
				<div className={ styles.addressRow }>
					{ creating ? (
						<div
							className={ styles.destinationRowControl }
							aria-label={ __( 'Creating preview link…' ) }
						>
							<Skeleton className={ styles.previewSkeletonIcon } />
							<div className={ styles.previewSkeletonLines }>
								<Skeleton className={ styles.previewSkeletonTitle } />
								<Skeleton className={ styles.previewSkeletonSubtitle } />
							</div>
						</div>
					) : (
						target && (
							<Menu.ContextMenuRoot>
								<Menu.ContextMenuTrigger
									render={
										<DestinationRow
											ref={ row }
											icon={ <LinkIcon /> }
											label={ hostname }
											description={ describePublishTarget( target, locale, targets.targets ) }
											trailing={ <ExternalLinkIcon /> }
											aria-label={ sprintf( __( 'Open preview: %s' ), hostname ) }
											onClick={ () => void connector.openExternalUrl( url ) }
										/>
									}
								/>
								<Menu.ContextPopup aria-label={ __( 'Preview actions' ) } finalFocus={ row }>
									{ renderActions( target ) }
								</Menu.ContextPopup>
							</Menu.ContextMenuRoot>
						)
					) }
				</div>
			</div>
			{ preview.overwrite && (
				<p className={ styles.changeStatus }>
					{ __(
						'Updating will replace changes made to this preview with your local files and database.'
					) }
				</p>
			) }
			<div className={ styles.shareFooter }>
				{ preview.overwrite ? (
					<>
						<Button variant="outline" onClick={ preview.cancelOverwrite }>
							{ __( 'Cancel' ) }
						</Button>
						<Button
							variant="accent"
							disabled={ ! preview.canUpdate }
							loading={ updating }
							onClick={ () => void preview.confirmOverwrite() }
						>
							{ __( 'Replace preview' ) }
						</Button>
					</>
				) : creating ? (
					<Button variant="accent" loading disabled>
						{ __( 'Creating preview link…' ) }
					</Button>
				) : current && ! updating ? (
					<Button variant="outline" onClick={ copy }>
						{ copied ? __( 'Copied' ) : __( 'Copy link' ) }
					</Button>
				) : (
					<Button
						variant="accent"
						disabled={ disabled || ! preview.canUpdate }
						loading={ updating }
						onClick={ () => void preview.updatePreview() }
					>
						{ updating ? __( 'Updating preview…' ) : __( 'Update preview' ) }
					</Button>
				) }
			</div>
		</section>
	);
}
