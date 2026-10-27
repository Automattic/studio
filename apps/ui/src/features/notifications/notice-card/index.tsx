import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { ChevronRightIcon, XIcon } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
	noticeToText,
	runNoticeAction,
	type NoticeIntent,
	type NoticeRecord,
	type ToastAction,
} from '@/data/app-messages';
import { useCopyText } from '@/data/host/use-copy-text';
import { ErrorIcon, InfoIcon, SuccessIcon, WarningIcon } from '@/lib/icons';
import { Button, IconButton } from '@/lib/ui';
import styles from './style.module.css';

type Notice = Pick<
	NoticeRecord,
	'intent' | 'title' | 'description' | 'action' | 'actionPending' | 'source'
>;

function StatusIcon( { intent, source }: { intent: NoticeIntent; source?: 'studio' } ) {
	const iconIntent = source === 'studio' ? 'info' : intent;
	return (
		<span className={ styles.status } data-intent={ iconIntent } aria-hidden="true">
			{
				{
					info: <InfoIcon />,
					warning: <WarningIcon />,
					success: <SuccessIcon />,
					error: <ErrorIcon />,
				}[ iconIntent ]
			}
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
			size="2xs"
			variant="outline"
			disabled={ pending }
			aria-busy={ pending || undefined }
			onClick={ async () => {
				if ( await runNoticeAction( action ) ) {
					onDone?.();
				}
			} }
		>
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
function NoticeDescription( {
	notice,
	titleClipped,
	expanded,
	setExpanded,
}: {
	notice: Notice;
	titleClipped: boolean;
	expanded: boolean;
	setExpanded: ( expanded: boolean ) => void;
} ) {
	const ref = useRef< HTMLParagraphElement >( null );
	const [ clamped, setClamped ] = useState( true );
	const [ expandable, setExpandable ] = useState( false );
	useLayoutEffect( () => {
		const description = ref.current;
		if ( ! description || ! clamped ) {
			return;
		}
		const update = () => setExpandable( description.scrollHeight > description.clientHeight + 1 );
		update();
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
				{ expandable || titleClipped || ! clamped ? (
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
							<ChevronRightIcon />
						</span>
					</button>
				) : null }
			</div>
		</div>
	);
}

export function NoticeCard( {
	className,
	notice,
	action,
	time,
	onDismiss,
	onActionDone,
}: {
	className?: string;
	notice: Notice;
	// In place of the notice's own action button.
	action?: ReactNode;
	time?: ReactNode;
	onDismiss: () => void;
	onActionDone?: () => void;
} ) {
	const titleRef = useRef< HTMLParagraphElement >( null );
	const [ titleClipped, setTitleClipped ] = useState( false );
	const [ expanded, setExpanded ] = useState( false );
	useLayoutEffect( () => {
		const title = titleRef.current;
		if ( ! title || expanded ) return;
		const update = () => setTitleClipped( title.scrollWidth > title.clientWidth + 1 );
		update();
		const observer = new ResizeObserver( update );
		observer.observe( title );
		return () => observer.disconnect();
	}, [ notice.title, expanded ] );
	const actionButton =
		action ??
		( notice.action ? (
			<NoticeActionButton
				action={ notice.action }
				pending={ notice.actionPending }
				onDone={ onActionDone }
			/>
		) : notice.intent === 'error' ? (
			<CopyNoticeButton notice={ notice } />
		) : null );
	return (
		<div className={ clsx( styles.card, className ) }>
			<div className={ styles.row } data-expanded={ expanded || undefined }>
				<StatusIcon intent={ notice.intent } source={ notice.source } />
				<div className={ styles.titleSummary }>
					<p ref={ titleRef } className={ styles.title } data-expanded={ expanded || undefined }>
						{ notice.title }
					</p>
					{ titleClipped && ! notice.description ? (
						<button
							type="button"
							className={ styles.toggle }
							aria-expanded={ expanded }
							aria-label={ sprintf(
								/* translators: %s: notification title. */
								__( 'View notification: %s' ),
								notice.title
							) }
							onClick={ () => setExpanded( ! expanded ) }
						>
							<span className={ styles.chevron } aria-hidden="true">
								<ChevronRightIcon />
							</span>
						</button>
					) : null }
				</div>
				{ actionButton || time ? (
					<div
						className={ styles.trailing }
						data-swap={ Boolean( actionButton && time ) || undefined }
						data-pending={ notice.actionPending || undefined }
					>
						{ time ? <span className={ styles.timestamp }>{ time }</span> : null }
						{ actionButton ? <span className={ styles.action }>{ actionButton }</span> : null }
					</div>
				) : null }
			</div>
			{ notice.description ? (
				<NoticeDescription
					notice={ notice }
					titleClipped={ titleClipped }
					expanded={ expanded }
					setExpanded={ setExpanded }
				/>
			) : null }

			<IconButton
				className={ styles.close }
				icon={ <XIcon /> }
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
