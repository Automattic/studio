import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
	noticeToText,
	runNoticeAction,
	type NoticeIntent,
	type Notice,
	type ToastAction,
} from '@/data/app-messages';
import { useCopyText } from '@/data/host/use-copy-text';
import {
	ChevronRightIcon,
	CircleXIcon,
	CircleInfoIcon,
	CircleCheckIcon,
	TriangleAlertIcon,
} from '@/lib/icons';
import { Button, DismissButton, Spinner } from '@/lib/ui';
import styles from './style.module.css';

function StatusIcon( { intent, source }: { intent: NoticeIntent; source?: 'studio' } ) {
	const iconIntent = source === 'studio' ? 'info' : intent;
	return (
		<span className={ styles.status } data-intent={ iconIntent } aria-hidden="true">
			{
				{
					info: <CircleInfoIcon />,
					warning: <TriangleAlertIcon />,
					success: <CircleCheckIcon />,
					error: <CircleXIcon />,
				}[ iconIntent ]
			}
		</span>
	);
}

function NoticeActionButton( { action, pending }: { action: ToastAction; pending?: boolean } ) {
	return (
		<Button
			size="2xs"
			variant="outline"
			disabled={ pending }
			aria-busy={ pending || undefined }
			onClick={ async () => {
				await runNoticeAction( action );
			} }
		>
			{ action.label }
		</Button>
	);
}

// Keep copy feedback on the button.
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
						data-notice-toggle=""
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
	onDismiss,
}: {
	className?: string;
	notice: Notice;
	// In place of the notice's own action button.
	action?: ReactNode;
	onDismiss?: () => void;
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
			<NoticeActionButton action={ notice.action } pending={ notice.actionPending } />
		) : notice.intent === 'error' ? (
			<CopyNoticeButton notice={ notice } />
		) : null );
	return (
		<div
			className={ clsx( styles.card, className ) }
			role="presentation"
			onClick={ ( event ) => {
				const target = event.target;
				if (
					event.defaultPrevented ||
					! ( target instanceof Element ) ||
					! event.currentTarget.contains( target ) ||
					target.closest( 'button, a, input, select, textarea, [contenteditable]' ) ||
					event.currentTarget.ownerDocument.getSelection()?.isCollapsed === false
				) {
					return;
				}
				event.currentTarget.querySelector< HTMLButtonElement >( '[data-notice-toggle]' )?.click();
			} }
		>
			<div className={ styles.row }>
				{ notice.processing ? (
					<span className={ styles.processing } aria-hidden="true">
						<Spinner />
					</span>
				) : (
					<StatusIcon intent={ notice.intent } source={ notice.source } />
				) }
				<div className={ styles.titleSummary }>
					<p
						ref={ titleRef }
						className={ clsx( styles.title, notice.processing && 'studio-shimmer' ) }
						data-expanded={ expanded || undefined }
					>
						{ notice.title }
					</p>
					{ titleClipped && ! notice.description ? (
						<button
							type="button"
							className={ styles.toggle }
							data-notice-toggle=""
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
				{ actionButton ? (
					<div className={ styles.trailing } data-pending={ notice.actionPending || undefined }>
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

			{ onDismiss ? (
				<DismissButton
					className={ styles.close }
					label={ __( 'Dismiss' ) }
					aria-label={ sprintf(
						/* translators: %s: notification title. */
						__( 'Dismiss %s' ),
						notice.title
					) }
					onClick={ onDismiss }
				/>
			) : null }
		</div>
	);
}
