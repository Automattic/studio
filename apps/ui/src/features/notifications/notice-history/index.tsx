import { __ } from '@wordpress/i18n';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { clearNoticeHistory, dismissNotice, useNoticeHistory } from '@/data/app-messages';
import { NoticeCard } from '@/features/notifications/notice-card';
import { BellIcon } from '@/lib/icons';
import { Button, IconButton, Popover, VisuallyHidden } from '@/lib/ui';
import { NoticeTime } from './notice-time';
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
	const history = useNoticeHistory();
	const now = useNow( open );
	// The list stays as it was while the popover closes, so emptying it doesn't
	// flash the empty state on the way out.
	const [ notices, setNotices ] = useState( history );
	if ( open && notices !== history ) {
		setNotices( history );
	}
	const bell = useRef< HTMLButtonElement >( null );
	// Opened from elsewhere as the sidebar slides in, the history waits for the
	// bell to get where it's going before anchoring to it.
	const [ anchored, setAnchored ] = useState( false );
	useLayoutEffect( () => {
		if ( ! open ) {
			setAnchored( false );
			return;
		}
		const trigger = bell.current;
		const moving = ( document.getAnimations?.() ?? [] ).filter( ( animation ) => {
			const target = ( animation.effect as KeyframeEffect | null )?.target;
			return trigger && target && target !== trigger && target.contains( trigger );
		} );
		if ( ! moving.length ) {
			setAnchored( true );
			return;
		}
		let cancelled = false;
		void Promise.allSettled( moving.map( ( animation ) => animation.finished ) ).then( () => {
			if ( ! cancelled ) {
				setAnchored( true );
			}
		} );
		return () => {
			cancelled = true;
		};
	}, [ open ] );

	return (
		<Popover.Root open={ open && anchored } onOpenChange={ setOpen }>
			<Popover.Trigger
				ref={ bell }
				render={
					<IconButton
						icon={ <BellIcon /> }
						label={ __( 'Notification history' ) }
						aria-label={
							history.length > 0
								? __( 'Notification history, notifications available' )
								: __( 'Notification history' )
						}
						className={ styles.bell }
					/>
				}
			>
				{ history.length > 0 ? <span className={ styles.dot } aria-hidden="true" /> : null }
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
										time={ <NoticeTime timestamp={ notice.shownAt } now={ now } /> }
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
