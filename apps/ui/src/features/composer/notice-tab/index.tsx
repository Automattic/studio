import { Button } from '@/lib/ui';
import styles from './style.module.css';
import type { SubmitFeedback } from '@/features/composer/use-submit-feedback';

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
			<div className={ styles.noticeContent } data-submit-feedback={ feedback ?? undefined }>
				<span className={ styles.noticeMessage }>{ notice.message }</span>
				{ notice.action ? (
					<Button
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
