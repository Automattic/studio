import { __ } from '@wordpress/i18n';
import { useRef, useState } from 'react';
import {
	checkNodes,
	FilePicker,
	PublishChecklist,
	publishSelectionSummary,
	useTransferSelection,
} from '@/features/sync';
import { ChevronDownIcon, SlidersVerticalIcon } from '@/lib/icons';
import {
	Button,
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
	Popover,
} from '@/lib/ui';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

export function PublishOptionsControl( {
	provider,
	site,
	remote,
	disabled,
}: {
	provider: import('@studio/providers').SitesProviderId;
	site: SiteDetails;
	remote: import('@studio/providers').RemoteSite;
	disabled: boolean;
} ) {
	const trigger = useRef< HTMLButtonElement >( null );
	const [ open, setOpen ] = useState( false );
	const selection = useTransferSelection( site, provider, remote, 'push', open );
	const [ chooseFiles, setChooseFiles ] = useState( false );
	const label = publishSelectionSummary( selection );
	return (
		<div>
			<Popover.Root open={ open } onOpenChange={ setOpen }>
				<Popover.Trigger
					render={
						<Button
							variant="ghost"
							ref={ trigger }
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
					className={ styles.publishOptionsPopover }
					aria-label={ __( 'What to publish' ) }
				>
					<PublishChecklist selection={ selection } />
					<Button
						variant="inline-link"
						size="inline"
						disabled={ selection.loadingFiles || !! selection.error }
						onClick={ () => {
							setOpen( false );
							setChooseFiles( true );
						} }
					>
						{ __( 'Choose individual files…' ) }
					</Button>
				</Popover.Popup>
			</Popover.Root>
			{ chooseFiles && (
				<PublishFilesDialog
					site={ site }
					provider={ provider }
					remote={ remote }
					selection={ selection }
					returnFocus={ trigger }
					onClose={ () => setChooseFiles( false ) }
				/>
			) }
		</div>
	);
}

function PublishFilesDialog( {
	site,
	provider,
	remote,
	selection,
	onClose,
	returnFocus,
}: {
	site: SiteDetails;
	provider: import('@studio/providers').SitesProviderId;
	remote: import('@studio/providers').RemoteSite;
	selection: ReturnType< typeof useTransferSelection >;
	returnFocus: React.RefObject< HTMLButtonElement | null >;
	onClose: () => void;
} ) {
	const draft = useTransferSelection( site, provider, remote, 'push', true, false, {
		scope: 'custom',
		nodes:
			selection.scope === 'custom'
				? selection.nodes
				: checkNodes( selection.nodes, selection.scope !== 'content' ),
		content: selection.scope === 'custom' ? selection.content : selection.scope !== 'files',
	} );
	return (
		<Dialog open onOpenChange={ ( open ) => ! open && onClose() }>
			<DialogContent finalFocus={ returnFocus }>
				<DialogHeader>
					<DialogTitle>{ __( 'Choose individual files' ) }</DialogTitle>
				</DialogHeader>
				<FilePicker selection={ draft } />
				{ draft.error && (
					<Button variant="inline-link" size="inline" onClick={ draft.retry }>
						{ __( 'Retry loading files' ) }
					</Button>
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
