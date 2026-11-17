import { __ } from '@wordpress/i18n';
import { CheckIcon } from 'lucide-react';
import { getSnapshotHostname } from '@/data/snapshot-url';
import { ChevronRightIcon } from '@/lib/icons';
import { Button } from '@/lib/ui';
import { DestinationRow } from './destination-row';
import { SiteDeliveryStep } from './site-delivery-step';
import styles from './style.module.css';
import type { PublishTarget } from './use-publish-targets';
import type { ReactNode, Ref } from 'react';

export function PreviewMenu( {
	previews,
	selectedPreview,
	showSinglePreview,
	onSelectPreview,
	switchingDisabled,
	locale,
	open,
	onOpen,
	onBack,
	onClose,
	triggerRef,
	onNewPreview,
	newPreviewDisabled,
	creating,
	unavailable,
	retryAvailability,
	renderActions,
}: {
	previews: PublishTarget[];
	selectedPreview?: PublishTarget;
	showSinglePreview: boolean;
	onSelectPreview: ( target: PublishTarget ) => void;
	switchingDisabled: boolean;
	locale?: string;
	open: boolean;
	onOpen: () => void;
	onBack: () => void;
	onClose: () => void;
	triggerRef: Ref< HTMLButtonElement >;
	onNewPreview: () => void;
	newPreviewDisabled: boolean;
	creating: boolean;
	unavailable?: string;
	retryAvailability?: () => void;
	renderActions: ( target: PublishTarget ) => ReactNode;
} ) {
	if ( ! open )
		return (
			( previews.length > 1 || ( showSinglePreview && previews.length === 1 ) ) && (
				<DestinationRow
					ref={ triggerRef }
					icon={
						<svg
							width="16"
							height="16"
							viewBox="0 0 256 256"
							fill="currentColor"
							aria-hidden="true"
						>
							<path d="M224,48V96a8,8,0,0,1-8,8H168a8,8,0,0,1,0-16h28.69L182.06,73.37a79.56,79.56,0,0,0-56.13-23.43h-.45A79.52,79.52,0,0,0,69.59,72.71,8,8,0,0,1,58.41,61.27a96,96,0,0,1,135,.79L208,76.69V48a8,8,0,0,1,16,0ZM186.41,183.29a80,80,0,0,1-112.47-.66L59.31,168H88a8,8,0,0,0,0-16H40a8,8,0,0,0-8,8v48a8,8,0,0,0,16,0V179.31l14.63,14.63A95.43,95.43,0,0,0,130,222.06h.53a95.36,95.36,0,0,0,67.07-27.33,8,8,0,0,0-11.18-11.44Z" />
						</svg>
					}
					label={ previews.length > 1 ? __( 'Switch previews' ) : __( 'Previews' ) }
					trailing={
						<>
							{ selectedPreview && (
								<span className={ styles.selectedPreviewName } aria-hidden="true">
									{ selectedPreview.label }
								</span>
							) }
							<ChevronRightIcon data-navigation-chevron />
						</>
					}
					aria-description={ new Intl.NumberFormat( locale ).format( previews.length ) }
					onClick={ onOpen }
					disabled={ switchingDisabled }
				/>
			)
		);
	return (
		<SiteDeliveryStep
			title={ __( 'Previews' ) }
			titleClassName={ styles.previewStepTitle }
			onBack={ onBack }
			onClose={ onClose }
		>
			<div className={ styles.previewListStep }>
				<div className={ styles.summaryRows }>
					{ previews.map( ( target ) => (
						<div className={ styles.previewListRow } key={ target.key }>
							<DestinationRow
								icon={
									target.key === selectedPreview?.key ? <CheckIcon aria-hidden="true" /> : null
								}
								label={ target.label }
								description={ getSnapshotHostname( target.snapshot! ) }
								aria-current={ target.key === selectedPreview?.key || undefined }
								disabled={ switchingDisabled }
								onClick={ () => {
									onSelectPreview( target );
									onBack();
								} }
							/>
							{ renderActions( target ) }
						</div>
					) ) }
					{ ! previews.length && (
						<p className={ styles.previewMenuNote }>{ __( 'No previews yet' ) }</p>
					) }
				</div>
				{ unavailable && <p className={ styles.previewMenuNote }>{ unavailable }</p> }
				{ retryAvailability && (
					<Button variant="outline" onClick={ retryAvailability }>
						{ __( 'Try again' ) }
					</Button>
				) }
				<Button
					variant="accent"
					disabled={ newPreviewDisabled }
					loading={ creating }
					onClick={ onNewPreview }
				>
					{ creating
						? __( 'Creating preview' )
						: previews.length
						? __( 'New preview' )
						: __( 'Create preview' ) }
				</Button>
			</div>
		</SiteDeliveryStep>
	);
}
