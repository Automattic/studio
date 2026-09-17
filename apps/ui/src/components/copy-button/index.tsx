import { __ } from '@wordpress/i18n';
import { check, copy, Icon } from '@wordpress/icons';
import { Tooltip } from '@wordpress/ui';
import { useCopyText } from '@/hooks/use-copy-text';
import styles from './style.module.css';

export function CopyButton( {
	text,
	label,
	className,
	variant = 'filled',
}: {
	text: string;
	label: string;
	className?: string;
	variant?: 'filled' | 'plain';
} ) {
	const { copied, copy: handleCopy } = useCopyText( text );

	const copiedLabel = __( 'Copied' );
	const tooltipLabel = copied ? copiedLabel : label;

	return (
		<div className={ className }>
			<Tooltip.Root>
				<Tooltip.Trigger
					render={
						<button
							type="button"
							className={ styles.copyButton }
							onClick={ handleCopy }
							aria-label={ label }
							data-copied={ copied ? 'true' : undefined }
							data-variant={ variant }
						>
							<Icon
								icon={ copied ? check : copy }
								size={ copied ? 20 : 16 }
								fill="currentColor"
								aria-hidden="true"
							/>
						</button>
					}
				/>
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
					{ tooltipLabel }
				</Tooltip.Popup>
			</Tooltip.Root>
			<span className={ styles.visuallyHidden } role="status" aria-live="polite" aria-atomic="true">
				{ copied ? copiedLabel : '' }
			</span>
		</div>
	);
}
