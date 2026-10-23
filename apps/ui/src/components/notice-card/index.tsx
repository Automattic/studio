import { __, sprintf } from '@wordpress/i18n';
import { caution, closeSmall, Icon, info } from '@wordpress/icons';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button, IconButton } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
	noticeToText,
	runNoticeAction,
	type NoticeIntent,
	type NoticeRecord,
	type ToastAction,
} from '@/data/app-messages';
import { useCopyText } from '@/hooks/use-copy-text';
import { chevronRightIcon } from '@/lib/icons';
import styles from './style.module.css';

type Notice = Pick< NoticeRecord, 'intent' | 'title' | 'description' | 'action' | 'actionPending' >;

function StatusIcon( { intent }: { intent: NoticeIntent } ) {
	return (
		<span className={ styles.status } data-intent={ intent } aria-hidden="true">
			{ intent === 'info' || intent === 'warning' ? (
				<Icon icon={ intent === 'info' ? info : caution } size={ 18 } />
			) : (
				<svg viewBox="0 0 24 24" fill="none">
					<path
						d={ intent === 'success' ? 'M20 6 9 17l-5-5' : 'M18 6 6 18M6 6l12 12' }
						stroke="currentColor"
						strokeWidth="3"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			) }
		</span>
	);
}

function NoticeActionButton( {
	action,
	pending,
	onDone,
}: {
	action: ToastAction;
	pending?: boolean;
	onDone?: () => void;
} ) {
	return (
		<Button
			size="sm"
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
// toast about copying a notice would itself land in the history.
function CopyNoticeButton( { notice }: { notice: Notice } ) {
	const { copied, copy } = useCopyText( noticeToText( notice ) );
	return (
		<Button variant="outline" size="2xs" onClick={ copy }>
			{ copied ? __( 'Copied' ) : __( 'Copy' ) }
		</Button>
	);
}

// One line until clicked; error text can run to a stack trace. Closing
// animates the height back to one line before the ellipsis returns.
function NoticeDescription( { notice }: { notice: Notice } ) {
	const ref = useRef< HTMLParagraphElement >( null );
	const [ expanded, setExpanded ] = useState( false );
	const [ clamped, setClamped ] = useState( true );
	const [ expandable, setExpandable ] = useState( false );
	useLayoutEffect( () => {
		const description = ref.current;
		if ( ! description || ! clamped ) {
			return;
		}
		const update = () => setExpandable( description.scrollHeight > description.clientHeight + 1 );
		update();
		if ( typeof ResizeObserver === 'undefined' ) {
			return;
		}
		const observer = new ResizeObserver( update );
		observer.observe( description );
		return () => observer.disconnect();
	}, [ notice.description, clamped ] );
	const toggle = () => {
		setExpanded( ! expanded );
		// Without size interpolation the height snaps and no transition ends.
		if ( ! expanded || ! globalThis.CSS?.supports( 'interpolate-size', 'allow-keywords' ) ) {
			setClamped( expanded );
		}
	};

	return (
		<div className={ styles.details }>
			<div className={ styles.summary }>
				<p
					ref={ ref }
					className={ styles.description }
					data-expanded={ expanded || undefined }
					data-clamped={ clamped || undefined }
					onTransitionEnd={ ( event ) => {
						if ( event.propertyName === 'height' && ! expanded ) {
							setClamped( true );
						}
					} }
				>
					{ notice.description }
				</p>
				{ expandable || ! clamped ? (
					<button
						type="button"
						className={ styles.toggle }
						aria-expanded={ expanded }
						aria-label={ sprintf(
							/* translators: %s: notification title. */
							__( 'View notification: %s' ),
							notice.title
						) }
						onClick={ toggle }
					>
						<span className={ styles.chevron } aria-hidden="true">
							<Icon icon={ chevronRightIcon } size={ 16 } />
						</span>
					</button>
				) : null }
			</div>
			{ expanded && notice.intent === 'error' ? <CopyNoticeButton notice={ notice } /> : null }
		</div>
	);
}

export function NoticeCard( {
	notice,
	time,
	onDismiss,
	onActionDone,
}: {
	notice: Notice;
	time?: ReactNode;
	onDismiss: () => void;
	onActionDone?: () => void;
} ) {
	return (
		<div className={ styles.card }>
			<div className={ styles.row }>
				<StatusIcon intent={ notice.intent } />
				<p className={ styles.title }>{ notice.title }</p>
				{ notice.action ? (
					<NoticeActionButton
						action={ notice.action }
						pending={ notice.actionPending }
						onDone={ onActionDone }
					/>
				) : null }
				{ time }
			</div>
			{ notice.description ? <NoticeDescription notice={ notice } /> : null }
			<IconButton
				className={ styles.close }
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
				onClick={ onDismiss }
			/>
		</div>
	);
}
