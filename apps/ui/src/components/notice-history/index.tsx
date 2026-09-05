import { __ } from '@wordpress/i18n';
import { bell } from '@wordpress/icons';
import { Button, Dialog, EmptyState, IconButton, Notice } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppThemeScope } from '@/components/app-theme-scope';
import {
	clearNoticeHistory,
	noticeToText,
	useNoticeHistory,
	type NoticeRecord,
} from '@/data/app-messages';
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

export function NoticeHistoryButton( { className }: { className?: string } ) {
	return (
		<IconButton
			variant="minimal"
			tone="neutral"
			size="small"
			className={ clsx( styles.bell, className ) }
			icon={ bell }
			label={ __( 'Recent notifications' ) }
			onClick={ openNoticeHistory }
		/>
	);
}

// Flips to "Copied" briefly; a toast would be the obvious feedback, but a
// toast about copying a notice would itself land in the list.
export function CopyNoticeButton( {
	notice,
	className,
	variant = 'solid',
}: {
	notice: Pick< NoticeRecord, 'title' | 'description' >;
	className?: string;
	variant?: 'solid' | 'outline';
} ) {
	const [ copied, setCopied ] = useState( false );
	const timer = useRef< ReturnType< typeof setTimeout > | undefined >( undefined );

	useEffect( () => () => clearTimeout( timer.current ), [] );

	const copy = async () => {
		await navigator.clipboard.writeText( noticeToText( notice ) );
		setCopied( true );
		clearTimeout( timer.current );
		timer.current = setTimeout( () => setCopied( false ), 1500 );
	};

	return (
		<Button
			size="small"
			variant={ variant }
			tone="neutral"
			className={ className }
			onClick={ () => void copy() }
		>
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
					<Dialog.Header className={ styles.header }>
						<Dialog.Title>{ __( 'Recent notifications' ) }</Dialog.Title>
					</Dialog.Header>
					<Dialog.Content>
						{ notices.length === 0 ? (
							<EmptyState.Root className={ styles.empty }>
								<EmptyState.Icon icon={ bell } />
								<EmptyState.Title>{ __( 'No notifications yet' ) }</EmptyState.Title>
								<EmptyState.Description>
									{ __(
										'Notices Studio shows you during this session collect here, until Studio\u00a0restarts.'
									) }
								</EmptyState.Description>
							</EmptyState.Root>
						) : (
							<>
								{ /* Description drops a passed className, so the spacing lives on
							     a wrapper. The NBSP keeps the last word from wrapping alone. */ }
								<div className={ styles.intro }>
									<Dialog.Description>
										{ __(
											'Notices from this session, newest first. They clear when Studio\u00a0restarts.'
										) }
									</Dialog.Description>
								</div>
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
														<CopyNoticeButton notice={ notice } variant="outline" />
													</Notice.Actions>
												) : null }
											</Notice.Root>
										</li>
									) ) }
								</ul>
							</>
						) }
					</Dialog.Content>
					<Dialog.Footer>
						{ notices.length > 0 ? (
							<Button
								variant="minimal"
								tone="neutral"
								className={ styles.clearAll }
								onClick={ clearNoticeHistory }
							>
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
