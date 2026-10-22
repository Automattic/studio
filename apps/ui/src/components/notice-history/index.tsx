import { __ } from '@wordpress/i18n';
import { EmptyState, Notice } from '@wordpress/ui';
import { useSyncExternalStore } from 'react';
import { Button, IconButton } from '@/components/ui/button';
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogScrollArea,
	DialogTitle,
} from '@/components/ui/dialog';
import {
	clearNoticeHistory,
	noticeToText,
	useNoticeHistory,
	type NoticeRecord,
} from '@/data/app-messages';
import { useCopyText } from '@/hooks/use-copy-text';
import { bellIcon } from '@/lib/icons';
import styles from './style.module.css';

// The dialog mounts once at the layout level; the bell and a toast's "More"
// both open it through this, so it works with the sidebar collapsed too.
let isOpen = false;
const listeners = new Set< () => void >();

function subscribe( listener: () => void ) {
	listeners.add( listener );
	return () => {
		listeners.delete( listener );
	};
}

function setOpen( next: boolean ) {
	if ( isOpen === next ) {
		return;
	}
	isOpen = next;
	for ( const listener of listeners ) {
		listener();
	}
}

export function openNoticeHistory(): void {
	setOpen( true );
}

export function closeNoticeHistory(): void {
	setOpen( false );
}

function useNoticeHistoryOpen(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => isOpen,
		() => false
	);
}

export function NoticeHistoryButton() {
	return (
		<IconButton
			icon={ bellIcon }
			label={ __( 'Notification history' ) }
			onClick={ openNoticeHistory }
		/>
	);
}

// Flips to "Copied" briefly; a toast would be the obvious feedback, but a
// toast about copying a notice would itself land in the list.
export function CopyNoticeButton( {
	notice,
}: {
	notice: Pick< NoticeRecord, 'title' | 'description' >;
} ) {
	const { copied, copy } = useCopyText( noticeToText( notice ) );

	return (
		<Button variant="outline" size="2xs" onClick={ copy }>
			{ copied ? __( 'Copied' ) : __( 'Copy' ) }
		</Button>
	);
}

function formatTime( timestamp: number ) {
	return new Intl.DateTimeFormat( undefined, { hour: 'numeric', minute: '2-digit' } ).format(
		timestamp
	);
}

export function NoticeHistoryDialog() {
	const open = useNoticeHistoryOpen();
	const notices = useNoticeHistory();

	return (
		<Dialog open={ open } onOpenChange={ setOpen }>
			<DialogContent showCloseButton={ false } className={ styles.dialog }>
				<DialogHeader>
					<DialogTitle>{ __( 'Notification history' ) }</DialogTitle>
				</DialogHeader>
				<DialogScrollArea>
					{ notices.length === 0 ? (
						<EmptyState.Root className={ styles.empty }>
							<EmptyState.Icon icon={ bellIcon } />
							<EmptyState.Title>{ __( 'No notifications yet' ) }</EmptyState.Title>
							<EmptyState.Description>
								{ __( 'Notices Studio shows you collect here, until Studio\u00a0restarts.' ) }
							</EmptyState.Description>
						</EmptyState.Root>
					) : (
						<>
							<ul className={ styles.list }>
								{ notices.map( ( notice ) => (
									<li key={ `${ notice.id }:${ notice.shownAt }` }>
										<Notice.Root intent={ notice.intent } className={ styles.notice }>
											<Notice.Title>{ notice.title }</Notice.Title>
											{ notice.description ? (
												<Notice.Description className={ styles.description }>
													{ notice.description }
												</Notice.Description>
											) : null }
											<time
												className={ styles.time }
												dateTime={ new Date( notice.shownAt ).toISOString() }
											>
												{ formatTime( notice.shownAt ) }
											</time>
											{ notice.description ? (
												<Notice.Actions>
													<CopyNoticeButton notice={ notice } />
												</Notice.Actions>
											) : null }
										</Notice.Root>
									</li>
								) ) }
							</ul>
							<DialogDescription className={ styles.outro }>
								{ __( 'Notifications are cleared automatically when Studio restarts.' ) }
							</DialogDescription>
						</>
					) }
				</DialogScrollArea>
				<DialogFooter>
					{ notices.length > 0 ? (
						<Button variant="ghost" className={ styles.clearAll } onClick={ clearNoticeHistory }>
							{ __( 'Clear all' ) }
						</Button>
					) : null }
					<DialogClose render={ <Button variant="outline" /> }>{ __( 'Close' ) }</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
