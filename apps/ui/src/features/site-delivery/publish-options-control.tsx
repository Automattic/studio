import { __ } from '@wordpress/i18n';
import { ChevronLeftIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
	checkNodes,
	FilePicker,
	PublishChecklist,
	publishSelectionSummary,
	useTransferSelection,
} from '@/features/sync';
import { ChevronDownIcon, ChevronRightIcon, SlidersVerticalIcon } from '@/lib/icons';
import { Button, Popover } from '@/lib/ui';
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
	const filesTrigger = useRef< HTMLButtonElement >( null );
	const [ open, setOpen ] = useState( false );
	const selection = useTransferSelection( site, provider, remote, 'push', open );
	const [ chooseFiles, setChooseFiles ] = useState( false );
	const returnToChecklist = () => {
		setChooseFiles( false );
		requestAnimationFrame( () => filesTrigger.current?.focus() );
	};
	const label = publishSelectionSummary( selection );
	return (
		<div>
			<Popover.Root
				open={ open }
				onOpenChange={ ( nextOpen ) => {
					setOpen( nextOpen );
					if ( ! nextOpen ) setChooseFiles( false );
				} }
			>
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
					aria-label={ chooseFiles ? __( 'Choose files' ) : __( 'What to publish' ) }
				>
					{ chooseFiles ? (
						<PublishFilesView
							site={ site }
							provider={ provider }
							remote={ remote }
							selection={ selection }
							onBack={ returnToChecklist }
						/>
					) : (
						<PublishChecklist selection={ selection }>
							<div className={ styles.publishFilesEntry }>
								<Button
									ref={ filesTrigger }
									variant="ghost"
									className={ styles.publishFilesTrigger }
									disabled={ selection.loadingFiles || !! selection.error }
									onClick={ () => setChooseFiles( true ) }
								>
									{ __( 'Choose specific files' ) }
									<ChevronRightIcon data-icon="inline-end" />
								</Button>
							</div>
						</PublishChecklist>
					) }
				</Popover.Popup>
			</Popover.Root>
		</div>
	);
}

function PublishFilesView( {
	site,
	provider,
	remote,
	selection,
	onBack,
}: {
	site: SiteDetails;
	provider: import('@studio/providers').SitesProviderId;
	remote: import('@studio/providers').RemoteSite;
	selection: ReturnType< typeof useTransferSelection >;
	onBack: () => void;
} ) {
	const heading = useRef< HTMLHeadingElement >( null );
	useEffect( () => heading.current?.focus(), [] );
	const draft = useTransferSelection( site, provider, remote, 'push', true, false, {
		scope: 'custom',
		nodes:
			selection.scope === 'custom'
				? selection.nodes
				: checkNodes( selection.nodes, selection.scope !== 'content' ),
		content: selection.scope === 'custom' ? selection.content : selection.scope !== 'files',
	} );
	return (
		<div className={ styles.publishFilesView }>
			<header className={ styles.publishFilesHeader }>
				<Popover.Title ref={ heading } tabIndex={ -1 }>
					{ __( 'Choose files' ) }
				</Popover.Title>
				<Popover.Description>
					{ __( 'Select the files and folders to publish.' ) }
				</Popover.Description>
			</header>
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
			<footer className={ styles.publishFilesFooter }>
				<Button variant="outline" onClick={ onBack }>
					<ChevronLeftIcon data-icon="inline-start" />
					{ __( 'Back' ) }
				</Button>
				<Button
					variant="accent"
					disabled={ draft.loadingFiles || !! draft.error || draft.blocked }
					onClick={ () => {
						selection.restore( draft.snapshot );
						onBack();
					} }
				>
					{ __( 'Done' ) }
				</Button>
			</footer>
		</div>
	);
}
