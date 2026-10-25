import { __ } from '@wordpress/i18n';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { clearNoticeHistory, dismissNotice, useNoticeHistory } from '@/data/app-messages';
import { NoticeCard } from '@/features/notifications/notice-card';
import { BellIcon } from '@/lib/icons';
import { Button, IconButton, Popover, VisuallyHidden } from '@/lib/ui';
import styles from './style.module.css';

// Shared with the toasts, which hide while the history is open.
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

export function useNoticeHistoryOpen(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => isOpen,
		() => false
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

export function NoticeHistoryButton() {
	const open = useNoticeHistoryOpen();
	const notices = useNoticeHistory();
	const now = useNow( open );

	return (
		<Popover.Root open={ open } onOpenChange={ setOpen }>
			<Popover.Trigger
				render={
					<IconButton
						icon={ <BellIcon /> }
						label={ __( 'Notification history' ) }
						aria-label={
							notices.length > 0
								? __( 'Notification history, notifications available' )
								: __( 'Notification history' )
						}
						className={ styles.bell }
					/>
				}
			>
				{ notices.length > 0 ? <span className={ styles.dot } aria-hidden="true" /> : null }
			</Popover.Trigger>
			<Popover.Popup
				side="top"
				align="end"
				sideOffset={ 8 }
				className={ notices.length > 0 ? styles.history : styles.empty }
			>
				<Popover.Title render={ <VisuallyHidden /> }>
					{ __( 'Notification history' ) }
				</Popover.Title>
				{ notices.length === 0 ? (
					<>
						<p className={ styles.emptyTitle }>{ __( 'No notifications.' ) }</p>
						<p className={ styles.emptyText }>
							{ __(
								'We’ll send you a notification when there’s something that needs your attention.'
							) }
						</p>
					</>
				) : (
					<>
						<Button
							variant="outline"
							className={ styles.clearAll }
							onClick={ () => {
								setOpen( false );
								clearNoticeHistory();
							} }
						>
							{ __( 'Clear all' ) }
						</Button>
						<ul className={ styles.list }>
							{ notices.map( ( notice ) => (
								<li key={ `${ notice.id }:${ notice.shownAt }` }>
									<NoticeCard
										notice={ notice }
										time={
											<time
												className={ styles.time }
												dateTime={ new Date( notice.shownAt ).toISOString() }
												title={ new Date( notice.shownAt ).toLocaleString() }
											>
												{ relativeTime( notice.shownAt, now ) }
											</time>
										}
										onActionDone={ closeNoticeHistory }
										onDismiss={ () => {
											if ( notices.length === 1 ) {
												setOpen( false );
											}
											dismissNotice( notice );
										} }
									/>
								</li>
							) ) }
						</ul>
					</>
				) }
			</Popover.Popup>
		</Popover.Root>
	);
}
