import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { CheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCopyText } from '@/hooks/use-copy-text';
import { DuplicateIcon } from '@/lib/icons/duplicate-icon';
import styles from './style.module.css';

export function CopyButton( {
	text,
	label,
	className,
	variant = 'filled',
	size = 'icon-xs',
}: {
	text: string;
	label: string;
	className?: string;
	variant?: 'filled' | 'plain';
	size?: 'icon-xs' | 'icon-sm';
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
							size={ size }
							className={ clsx( variant === 'filled' && styles.filled, copied && styles.copied ) }
							onClick={ handleCopy }
							aria-label={ label }
						>
							{ copied ? <CheckIcon /> : <DuplicateIcon /> }
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
