import { __ } from '@wordpress/i18n';
import { Dialog, EmptyState, Notice } from '@wordpress/ui';
import { useSyncExternalStore } from 'react';
import { AppThemeScope } from '@/components/app-theme-scope';
import { Button, IconButton } from '@/components/ui/button';
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
		// Opened from the sidebar's dark chrome scope; without this the dialog
		// inherits that palette and renders dark on top of the light app.
		<AppThemeScope>
			<Dialog.Root open={ open } onOpenChange={ setOpen }>
				<Dialog.Popup size="medium">
					<Dialog.Header>
						<Dialog.Title>{ __( 'Notification history' ) }</Dialog.Title>
					</Dialog.Header>
					<Dialog.Content>
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
								{ /* Description drops a passed className, so the note lives on a
								     wrapper. */ }
								<div className={ styles.outro }>
									<Dialog.Description>
										{ __( 'Notifications are cleared automatically when Studio restarts.' ) }
									</Dialog.Description>
								</div>
							</>
						) }
					</Dialog.Content>
					<Dialog.Footer>
						{ notices.length > 0 ? (
							<Button variant="ghost" className={ styles.clearAll } onClick={ clearNoticeHistory }>
								{ __( 'Clear all' ) }
							</Button>
						) : null }
						<Dialog.Action variant="minimal" tone="neutral">
							{ __( 'Close' ) }
						</Dialog.Action>
					</Dialog.Footer>
				</Dialog.Popup>
			</Dialog.Root>
		</AppThemeScope>
	);
}
