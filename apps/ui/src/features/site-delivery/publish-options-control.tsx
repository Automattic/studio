import {
	Button,
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
	Popover,
} from '@studio/ds';
import { ChevronDownIcon, ChevronRightIcon, SlidersVerticalIcon } from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import { useRef, type RefObject } from 'react';
import {
	checkNodes,
	FilePicker,
	PublishChecklist,
	publishSelectionSummary,
	useTransferSelection,
} from '@/features/sync';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { RemoteSite, SitesProviderId } from '@studio/providers';

type PublishSelection = ReturnType< typeof useTransferSelection >;

export function PublishOptionsControl( {
	selection,
	disabled,
	onChooseFiles,
	triggerRef,
}: {
	selection: PublishSelection;
	disabled?: boolean;
	onChooseFiles: () => void;
	triggerRef: RefObject< HTMLButtonElement | null >;
} ) {
	const label = publishSelectionSummary( selection );
	return (
		<div>
			<Popover.Root>
				<Popover.Trigger
					render={
						<Button
							variant="outline"
							ref={ triggerRef }
							className={ styles.accessTrigger }
							disabled={ disabled }
							aria-label={ __( 'What to publish' ) }
							aria-description={ label }
						/>
					}
				>
					<span className={ styles.destinationRowIcon }>
						<SlidersVerticalIcon />
					</span>
					<span className={ styles.accessTriggerLabel }>{ __( 'What to publish' ) }</span>
					<span className={ styles.accessTriggerEnd } data-icon="inline-end">
						<span className={ styles.accessTriggerValue }>{ label }</span>
						<ChevronDownIcon data-dropdown-indicator />
					</span>
				</Popover.Trigger>
				<Popover.Popup
					className={ styles.publishOptionsPopover }
					aria-label={ __( 'What to publish' ) }
				>
					<PublishChecklist selection={ selection }>
						<Button
							variant="ghost"
							size="sm"
							className={ styles.publishFilesTrigger }
							disabled={ selection.loadingFiles || !! selection.error }
							onClick={ onChooseFiles }
						>
							{ __( 'Choose specific files' ) }
							<ChevronRightIcon data-icon="inline-end" />
						</Button>
					</PublishChecklist>
				</Popover.Popup>
			</Popover.Root>
		</div>
	);
}

export function PublishFilesDialog( {
	site,
	provider,
	remote,
	onClose,
	selection,
}: {
	site: SiteDetails;
	provider: SitesProviderId;
	remote: RemoteSite;
	onClose: () => void;
	selection: PublishSelection;
} ) {
	const heading = useRef< HTMLHeadingElement >( null );
	const draft = useTransferSelection( site, provider, remote, 'push', true, false, {
		scope: 'custom',
		nodes:
			selection.scope === 'custom'
				? selection.nodes
				: checkNodes( selection.nodes, selection.scope !== 'content' ),
		content: selection.scope === 'custom' ? selection.content : selection.scope !== 'files',
	} );
	return (
		<Dialog open onOpenChange={ ( next ) => ! next && onClose() }>
			<DialogContent
				layout="compact"
				className={ styles.publishFilesDialog }
				initialFocus={ heading }
				finalFocus={ false }
			>
				<DialogHeader>
					<DialogTitle ref={ heading } tabIndex={ -1 }>
						{ __( 'Choose files' ) }
					</DialogTitle>
					<DialogDescription>
						{ __( 'Select the files and folders to publish.' ) }
					</DialogDescription>
				</DialogHeader>
				<div className={ styles.publishFilesList }>
					{ draft.error ? (
						<p role="alert">
							{ __( 'Files could not be loaded.' ) }{ ' ' }
							<Button variant="inline-link" size="inline" onClick={ draft.retry }>
								{ __( 'Try again' ) }
							</Button>
						</p>
					) : (
						<FilePicker selection={ draft } includeDatabase={ false } />
					) }
				</div>
				{ draft.blocked && (
					<p className={ styles.publishFilesHint } role="status">
						{ __( 'Select at least one file or folder.' ) }
					</p>
				) }
				<DialogFooter>
					<Button
						variant="accent"
						disabled={ draft.loadingFiles || !! draft.error || draft.blocked }
						onClick={ () => {
							selection.restore( draft.snapshot );
							onClose();
						} }
					>
						{ __( 'Done' ) }
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
