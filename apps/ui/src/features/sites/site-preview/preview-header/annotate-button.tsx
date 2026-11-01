import { __, _n, sprintf } from '@wordpress/i18n';
import { AnnotateIcon } from '@/lib/icons';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@/lib/ui';
import styles from './style.module.css';
import type { ReactNode } from 'react';

export function AnnotateButton( {
	active,
	disabled,
	disabledReason,
	onClick,
	cancel,
	send,
}: {
	active: boolean;
	disabled: boolean;
	disabledReason?: string;
	onClick: () => void;
	cancel?: ReactNode;
	send?: {
		count: number;
		visible: boolean;
		disabled: boolean;
		loading: boolean;
		onClick: () => void;
	};
} ) {
	const showSend = active && Boolean( send?.visible );
	return (
		<span
			className={ styles.annotationControl }
			data-active={ active }
			data-has-annotations={ showSend }
			title={ disabled ? disabledReason : undefined }
		>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="outline"
							size="header"
							className={ styles.annotateButton }
							aria-label={ __( 'Annotate' ) }
							aria-pressed={ active }
							aria-description={
								disabled
									? disabledReason
									: active
									? __( 'Exit annotation mode. Your notes will be kept.' )
									: undefined
							}
							disabled={ disabled }
							onClick={ onClick }
						>
							<AnnotateIcon data-icon="inline-start" />
							<span>{ __( 'Annotate' ) }</span>
						</Button>
					}
				/>
				<TooltipContent side="bottom">
					{ disabledReason ?? ( active ? __( 'Exit annotation mode' ) : __( 'Annotate' ) ) }
				</TooltipContent>
			</Tooltip>
			{ send ? (
				<span
					className={ styles.annotationSendSlot }
					data-annotation-actions
					data-open={ showSend }
					aria-hidden={ ! showSend }
					inert={ ! showSend }
				>
					<span className={ styles.annotationSendContent }>
						<span className={ styles.annotationSendMotion }>
							<span className={ styles.annotationDivider } aria-hidden="true" />
							{ cancel ? <span className={ styles.annotationAction }>{ cancel }</span> : null }
							{ cancel ? <span className={ styles.annotationDivider } aria-hidden="true" /> : null }
							<span className={ styles.annotationAction }>
								<Button
									variant="accent"
									size="header"
									className={ styles.annotationSend }
									aria-label={ sprintf(
										/* translators: %d: number of annotations. */
										_n( 'Send %d annotation', 'Send %d annotations', send.count ),
										send.count
									) }
									disabled={ send.disabled || ! send.count || ! showSend }
									loading={ send.loading }
									loadingMode="replace"
									onClick={ send.onClick }
								>
									{ __( 'Send' ) }
								</Button>
							</span>
						</span>
					</span>
				</span>
			) : null }
		</span>
	);
}
