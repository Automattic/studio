import { Button, MarqueeLabel } from '@/lib/ui';
import styles from './style.module.css';
import type { SubmitFeedback } from '@/lib/hooks';

export interface ComposerNotice {
	message: string;
	walkthroughReason?:
		| 'offline'
		| 'provider_error'
		| 'connect'
		| 'quota_error'
		| 'provider_blocked'
		| 'beta_access'
		| 'payment_method'
		| 'credits';
	walkthroughTitle?: string;
	walkthroughDescription?: string;
	action?: { label: string; onClick: () => void };
}

// Why the chat can't send right now, as a tab above the composer.
export function NoticeTab( {
	notice,
	feedback,
	walkthrough = false,
}: {
	notice: ComposerNotice;
	feedback: SubmitFeedback;
	walkthrough?: boolean;
} ) {
	const walkthroughProps = {
		'data-walkthrough-blocked': walkthrough || undefined,
		'data-walkthrough-reason': notice.walkthroughReason,
		'data-walkthrough-title': notice.walkthroughTitle,
		'data-walkthrough-description': notice.walkthroughDescription ?? notice.message,
	};
	return (
		<div
			className={ styles.notice }
			role="alert"
			data-feedback={ feedback ?? undefined }
			data-walkthrough={ walkthrough && ! notice.action ? 'composer' : undefined }
			{ ...walkthroughProps }
		>
			<div
				className={ styles.noticeContent }
				data-marquee-row
				data-feedback={ feedback ?? undefined }
			>
				<MarqueeLabel>{ notice.message }</MarqueeLabel>
				{ notice.action ? (
					<Button
						data-walkthrough={ walkthrough ? 'composer' : undefined }
						{ ...walkthroughProps }
						size="composer-notice"
						shape="round"
						variant={ feedback ? 'destructive' : 'outline' }
						onClick={ notice.action.onClick }
					>
						{ notice.action.label }
					</Button>
				) : null }
			</div>
		</div>
	);
}
