import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { AnnotateIcon } from '@/lib/icons';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@/lib/ui';
import styles from './style.module.css';

export function AnnotateButton( {
	active,
	disabled,
	disabledReason,
	iconOnly,
	onClick,
}: {
	active: boolean;
	disabled: boolean;
	disabledReason?: string;
	iconOnly: boolean;
	onClick: () => void;
} ) {
	return (
		<span
			className={ styles.disabledControlTooltipTarget }
			title={ disabled ? disabledReason : undefined }
		>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							className={ clsx( styles.annotateButton, active && styles.annotateButtonActive ) }
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
							{ iconOnly ? null : <span>{ __( 'Annotate' ) }</span> }
						</Button>
					}
				/>
				<TooltipContent side="bottom">
					{ disabledReason ?? ( active ? __( 'Exit annotation mode' ) : __( 'Annotate' ) ) }
				</TooltipContent>
			</Tooltip>
		</span>
	);
}
