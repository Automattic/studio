import { __ } from '@wordpress/i18n';
import { check, copy, Icon } from '@wordpress/icons';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="muted-ghost"
							size="icon-xs"
							className={ clsx( variant === 'filled' && styles.filled, copied && styles.copied ) }
							onClick={ handleCopy }
							aria-label={ label }
						>
							<Icon icon={ copied ? check : copy } fill="currentColor" aria-hidden="true" />
						</Button>
					}
				/>
				<TooltipContent>{ tooltipLabel }</TooltipContent>
			</Tooltip>
			<span className={ styles.visuallyHidden } role="status" aria-live="polite" aria-atomic="true">
				{ copied ? copiedLabel : '' }
			</span>
		</div>
	);
}
