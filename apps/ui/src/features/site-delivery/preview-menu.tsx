import { __ } from '@wordpress/i18n';
import { useId } from 'react';
import { useConnector } from '@/data/core';
import { useCopyText } from '@/data/host/use-copy-text';
import { getSnapshotUrl } from '@/data/snapshot-url';
import { ChevronDownIcon, DuplicateIcon, ExternalLinkIcon, LinkIcon, PlusIcon } from '@/lib/icons';
import { Button, Menu, Spinner } from '@/lib/ui';
import styles from './style.module.css';
import { describePublishTarget } from './target-description';
import type { PublishTarget } from './use-publish-targets';
import type { ReactNode } from 'react';

function PreviewLinks( { url }: { url: string } ) {
	const connector = useConnector();
	const { copy } = useCopyText( url, __( 'Link copied' ) );
	return (
		<>
			<Menu.Item onClick={ () => void connector.openExternalUrl( url ) }>
				<ExternalLinkIcon />
				{ __( 'Open preview' ) }
			</Menu.Item>
			<Menu.Item onClick={ copy }>
				<DuplicateIcon />
				{ __( 'Copy link' ) }
			</Menu.Item>
		</>
	);
}

export function PreviewMenu( {
	previews,
	targets,
	locale,
	open,
	onOpenChange,
	onNewPreview,
	newPreviewDisabled,
	creating,
	unavailable,
	retryAvailability,
	renderActions,
}: {
	previews: PublishTarget[];
	targets: PublishTarget[];
	locale?: string;
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	onNewPreview: () => void;
	newPreviewDisabled: boolean;
	creating: boolean;
	unavailable?: string;
	retryAvailability?: () => void;
	renderActions: ( target: PublishTarget ) => ReactNode;
} ) {
	const id = useId();
	const count = previews.length
		? new Intl.NumberFormat( locale ).format( previews.length )
		: __( 'None' );
	const createLabel = creating
		? __( 'Creating preview link…' )
		: previews.length > 0
		? __( 'New preview' )
		: __( 'Create preview link' );
	return (
		<div>
			<Menu.Root open={ open } onOpenChange={ onOpenChange }>
				<Menu.Trigger
					render={
						<Button
							variant="ghost"
							className={ styles.accessTrigger }
							aria-label={ __( 'Previews' ) }
							aria-description={ count }
						/>
					}
				>
					<LinkIcon data-icon="inline-start" />
					<span className={ styles.accessTriggerLabel }>{ __( 'Previews' ) }</span>
					<span className={ styles.accessTriggerEnd } data-icon="inline-end">
						<span className={ styles.previewCount }>{ count }</span>
						<ChevronDownIcon data-dropdown-indicator />
					</span>
				</Menu.Trigger>
				<Menu.Popup
					side="bottom"
					align="end"
					aria-label={ __( 'Previews' ) }
					className={ styles.previewMenu }
				>
					{ previews.map( ( target ) => (
						<Menu.SubmenuRoot key={ target.key }>
							<Menu.SubmenuTrigger
								label={ target.label }
								aria-label={ target.label }
								aria-describedby={ `${ id }-${ target.key }` }
							>
								<span className={ styles.accessChoiceText }>
									<Menu.ItemLabel>{ target.label }</Menu.ItemLabel>
									<span className={ styles.accessDescription } id={ `${ id }-${ target.key }` }>
										{ describePublishTarget( target, locale, targets ) }
									</span>
								</span>
							</Menu.SubmenuTrigger>
							<Menu.SubmenuPopup aria-label={ target.label }>
								<PreviewLinks url={ getSnapshotUrl( target.snapshot! ) } />
								{ renderActions( target ) }
							</Menu.SubmenuPopup>
						</Menu.SubmenuRoot>
					) ) }
					{ previews.length > 0 && <Menu.Separator /> }
					<Menu.Item
						aria-label={ createLabel }
						aria-describedby={
							! previews.length && ! creating && ! unavailable ? `${ id }-visibility` : undefined
						}
						disabled={ newPreviewDisabled }
						closeOnClick={ false }
						onClick={ onNewPreview }
					>
						{ creating ? <Spinner aria-hidden="true" /> : <PlusIcon /> }
						<span className={ styles.accessChoiceText }>
							<span>{ createLabel }</span>
							{ ! previews.length && ! creating && ! unavailable && (
								<span id={ `${ id }-visibility` } className={ styles.accessDescription }>
									{ __( 'Anyone with the link can view the preview until it expires.' ) }
								</span>
							) }
						</span>
					</Menu.Item>
					{ unavailable && <p className={ styles.previewMenuNote }>{ unavailable }</p> }
					{ retryAvailability && (
						<Menu.Item closeOnClick={ false } onClick={ retryAvailability }>
							{ __( 'Try again' ) }
						</Menu.Item>
					) }
				</Menu.Popup>
			</Menu.Root>
		</div>
	);
}
