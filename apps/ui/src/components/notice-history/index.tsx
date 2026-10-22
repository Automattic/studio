import { __, sprintf } from '@wordpress/i18n';
import { caution, closeSmall, error, Icon, info, published } from '@wordpress/icons';
import { useEffect, useState, useSyncExternalStore, type ComponentProps } from 'react';
import {
	Alert,
	AlertActions,
	AlertDescription,
	AlertTitle,
	INTENT_VARIANTS,
} from '@/components/ui/alert';
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
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import {
	clearNoticeHistory,
	dismissNotice,
	noticeToText,
	runNoticeAction,
	useNoticeHistory,
	type NoticeRecord,
	type ToastAction,
} from '@/data/app-messages';
import { useCopyText } from '@/hooks/use-copy-text';
import { bellIcon } from '@/lib/icons';
import styles from './style.module.css';

const INTENT_ICONS = { info, success: published, warning: caution, error };

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
	const hasNotifications = useNoticeHistory().length > 0;
	return (
		<IconButton
			icon={ bellIcon }
			label={ __( 'Notification history' ) }
			aria-label={
				hasNotifications
					? __( 'Notification history, notifications available' )
					: __( 'Notification history' )
			}
			className={ styles.bell }
			onClick={ openNoticeHistory }
		>
			{ hasNotifications ? <span className={ styles.dot } aria-hidden="true" /> : null }
		</IconButton>
	);
}

export function NoticeActionButton( {
	action,
	pending,
	onDone,
	...props
}: {
	action: ToastAction;
	pending?: boolean;
	onDone?: () => void;
} & Omit< ComponentProps< typeof Button >, 'onClick' > ) {
	return (
		<Button
			size="sm"
			{ ...props }
			disabled={ pending }
			aria-busy={ pending || undefined }
			onClick={ async () => {
				if ( await runNoticeAction( action ) ) {
					onDone?.();
				}
			} }
		>
			{ pending ? <Spinner aria-hidden="true" /> : null }
			{ action.label }
		</Button>
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

function relativeTime( timestamp: number, now: number ) {
	const minutes = Math.max( 0, Math.floor( ( now - timestamp ) / 60_000 ) );
	if ( minutes === 0 ) {
		return __( 'Just now' );
	}
	const format = new Intl.RelativeTimeFormat( undefined, { numeric: 'auto', style: 'short' } );
	if ( minutes < 60 ) {
		return format.format( -minutes, 'minute' );
	}
	return minutes < 1440
		? format.format( -Math.floor( minutes / 60 ), 'hour' )
		: format.format( -Math.floor( minutes / 1440 ), 'day' );
}

function useNow( active: boolean ) {
	const [ now, setNow ] = useState( Date.now );
	useEffect( () => {
		if ( ! active ) {
			return;
		}
		setNow( Date.now() );
		const timer = setInterval( () => setNow( Date.now() ), 60_000 );
		return () => clearInterval( timer );
	}, [ active ] );
	return now;
}

export function NoticeHistoryDialog() {
	const open = useNoticeHistoryOpen();
	const notices = useNoticeHistory();
	const now = useNow( open );

	return (
		<Dialog open={ open } onOpenChange={ setOpen }>
			<DialogContent showCloseButton={ false } className={ styles.dialog }>
				<DialogHeader>
					<DialogTitle>{ __( 'Notification history' ) }</DialogTitle>
				</DialogHeader>
				<DialogScrollArea className={ styles.scrollArea }>
					{ notices.length === 0 ? (
						<Empty className={ styles.empty }>
							<EmptyMedia>{ bellIcon }</EmptyMedia>
							<EmptyTitle>{ __( 'No notifications yet' ) }</EmptyTitle>
							<EmptyDescription>
								{ __( 'Notices Studio shows you collect here, until Studio\u00a0restarts.' ) }
							</EmptyDescription>
						</Empty>
					) : (
						<>
							<ul className={ styles.list }>
								{ notices.map( ( notice ) => (
									<li key={ `${ notice.id }:${ notice.shownAt }` }>
										<Alert variant={ INTENT_VARIANTS[ notice.intent ] } role="none">
											<Icon icon={ INTENT_ICONS[ notice.intent ] } />
											<AlertTitle>{ notice.title }</AlertTitle>
											{ notice.description ? (
												<AlertDescription className={ styles.description }>
													{ notice.description }
												</AlertDescription>
											) : null }
											<time
												className={ styles.time }
												dateTime={ new Date( notice.shownAt ).toISOString() }
												title={ new Date( notice.shownAt ).toLocaleString() }
											>
												{ relativeTime( notice.shownAt, now ) }
											</time>
											{ notice.action || notice.description ? (
												<AlertActions>
													{ notice.action ? (
														<NoticeActionButton
															action={ notice.action }
															pending={ notice.actionPending }
															variant="outline"
															size="2xs"
															onDone={ closeNoticeHistory }
														/>
													) : null }
													{ notice.description ? <CopyNoticeButton notice={ notice } /> : null }
												</AlertActions>
											) : null }
											<IconButton
												className={ styles.dismiss }
												icon={ closeSmall }
												label={ __( 'Dismiss' ) }
												aria-label={ sprintf(
													/* translators: %s: notification title. */
													__( 'Dismiss %s' ),
													notice.title
												) }
												variant="outline"
												size="icon-2xs"
												shape="round"
												onClick={ () => dismissNotice( notice ) }
											/>
										</Alert>
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
