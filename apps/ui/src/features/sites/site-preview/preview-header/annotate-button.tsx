import { __, _n, sprintf } from '@wordpress/i18n';
import { AnnotateIcon } from '@/lib/icons';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@/lib/ui';
import styles from './style.module.css';

export function AnnotateButton( {
	active,
	disabled,
	disabledReason,
	iconOnly,
	onClick,
	send,
}: {
	active: boolean;
	disabled: boolean;
	disabledReason?: string;
	iconOnly: boolean;
	onClick: () => void;
	send?: { count: number; disabled: boolean; loading: boolean; onClick: () => void };
} ) {
	return (
		<span
			className={ styles.annotationControl }
			data-active={ active }
			title={ disabled ? disabledReason : undefined }
		>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="accent-ghost"
							size={ iconOnly ? 'icon' : 'default' }
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
							<AnnotateIcon data-icon={ iconOnly ? undefined : 'inline-start' } />
							{ iconOnly ? null : <span>{ __( 'Annotate' ) }</span> }
						</Button>
					}
				/>
				<TooltipContent side="bottom">
					{ disabledReason ?? ( active ? __( 'Exit annotation mode' ) : __( 'Annotate' ) ) }
				</TooltipContent>
			</Tooltip>
			{ send ? (
				<span className={ styles.annotationSendSlot } aria-hidden={ ! active } inert={ ! active }>
					<span className={ styles.annotationSendContent }>
						<Button
							variant="accent"
							size="header"
							className={ styles.annotationSend }
							aria-label={ sprintf(
								/* translators: %d: number of annotations. */
								_n( 'Send %d annotation', 'Send %d annotations', send.count ),
								send.count
							) }
							disabled={ disabled || send.disabled || ! send.count || ! active }
							loading={ send.loading }
							loadingMode="replace"
							onClick={ send.onClick }
						>
							{ __( 'Send' ) }
						</Button>
					</span>
				</span>
			) : null }
		</span>
	);
}
