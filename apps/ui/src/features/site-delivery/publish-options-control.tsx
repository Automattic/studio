import { __ } from '@wordpress/i18n';
import { useRef, useState, type RefObject } from 'react';
import {
	checkNodes,
	FilePicker,
	PublishChecklist,
	publishSelectionSummary,
	useTransferSelection,
} from '@/features/sync';
import { ChevronDownIcon, ChevronRightIcon, SlidersVerticalIcon } from '@/lib/icons';
import {
	Button,
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
	Popover,
} from '@/lib/ui';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { RemoteSite, SitesProviderId } from '@studio/providers';

export function PublishOptionsControl( {
	provider,
	site,
	remote,
	disabled,
	choosingFiles,
	onChooseFiles,
	triggerRef,
}: {
	provider: SitesProviderId;
	site: SiteDetails;
	remote: RemoteSite;
	disabled: boolean;
	choosingFiles: boolean;
	onChooseFiles: () => void;
	triggerRef: RefObject< HTMLButtonElement | null >;
} ) {
	const [ open, setOpen ] = useState( false );
	const selection = useTransferSelection( site, provider, remote, 'push', open );
	const label = publishSelectionSummary( selection );
	return (
		<div>
			<Popover.Root open={ open && ! choosingFiles } onOpenChange={ setOpen }>
				<Popover.Trigger
					render={
						<Button
							variant="ghost"
							ref={ triggerRef }
							className={ styles.accessTrigger }
							disabled={ disabled }
							aria-label={ __( 'What to publish' ) }
							aria-description={ label }
						/>
					}
				>
					<SlidersVerticalIcon data-icon="inline-start" />
					<span className={ styles.accessTriggerLabel }>{ __( 'What to publish' ) }</span>
					<span className={ styles.accessTriggerEnd } data-icon="inline-end">
						<span className={ styles.accessTriggerValue }>{ label }</span>
						<ChevronDownIcon data-dropdown-indicator />
					</span>
				</Popover.Trigger>
				<Popover.Popup
					align="end"
					instant={ choosingFiles }
					className={ styles.publishOptionsPopover }
					aria-label={ __( 'What to publish' ) }
				>
					<PublishChecklist selection={ selection }>
						<div className={ styles.publishFilesEntry }>
							<Button
								variant="ghost"
								className={ styles.publishFilesTrigger }
								disabled={ selection.loadingFiles || !! selection.error }
								onClick={ onChooseFiles }
							>
								{ __( 'Choose specific files' ) }
								<ChevronRightIcon data-icon="inline-end" />
							</Button>
						</div>
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
	returnFocus,
}: {
	site: SiteDetails;
	provider: SitesProviderId;
	remote: RemoteSite;
	onClose: () => void;
	returnFocus: RefObject< HTMLButtonElement | null >;
} ) {
	const heading = useRef< HTMLHeadingElement >( null );
	const selection = useTransferSelection( site, provider, remote, 'push', false );
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
				finalFocus={ returnFocus }
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
