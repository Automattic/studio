import { Button } from '@/lib/ui';
import styles from './style.module.css';
import type { SubmitFeedback } from '@/lib/hooks';

export interface ComposerNotice {
	message: string;
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
	return (
		<div
			className={ styles.notice }
			role="alert"
			data-feedback={ feedback ?? undefined }
			data-walkthrough={ walkthrough && ! notice.action ? 'composer' : undefined }
			data-walkthrough-blocked={ walkthrough ? true : undefined }
			data-walkthrough-title={ notice.walkthroughTitle }
			data-walkthrough-description={ notice.walkthroughDescription ?? notice.message }
		>
			<div className={ styles.noticeContent } data-feedback={ feedback ?? undefined }>
				<span className={ styles.noticeMessage }>{ notice.message }</span>
				{ notice.action ? (
					<Button
						data-walkthrough={ walkthrough ? 'composer' : undefined }
						data-walkthrough-blocked={ walkthrough ? true : undefined }
						data-walkthrough-title={ notice.walkthroughTitle }
						data-walkthrough-description={ notice.walkthroughDescription ?? notice.message }
						size="composer-notice"
						shape="round"
						variant={ feedback ? 'destructive' : 'default' }
						onClick={ notice.action.onClick }
					>
						{ notice.action.label }
					</Button>
				) : null }
			</div>
		</div>
	);
}
