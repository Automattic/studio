import { Button, MarqueeLabel } from '@/lib/ui';
import styles from './style.module.css';
import type { SubmitFeedback } from '@/lib/hooks';

export interface ComposerNotice {
	message: string;
	action?: { label: string; onClick: () => void };
}

// Why the chat can't send right now, as a tab above the composer.
export function NoticeTab( {
	notice,
	feedback,
}: {
	notice: ComposerNotice;
	feedback: SubmitFeedback;
} ) {
	return (
		<div className={ styles.notice } role="alert" data-feedback={ feedback ?? undefined }>
			<div
				className={ styles.noticeContent }
				data-marquee-row
				data-feedback={ feedback ?? undefined }
			>
				<MarqueeLabel>{ notice.message }</MarqueeLabel>
				{ notice.action ? (
					<Button
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
