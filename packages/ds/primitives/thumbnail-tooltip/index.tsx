import { useState, type ReactElement, type ReactNode } from 'react';
import { PreviewFrame, PreviewImage } from '../preview-frame';
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip';
import styles from './style.module.css';

export function ThumbnailTooltipImage( {
	thumbnail,
	label,
}: {
	thumbnail?: string | null;
	label: string;
} ) {
	const [ failedImage, setFailedImage ] = useState< string >();
	if ( ! thumbnail || thumbnail === failedImage ) return null;
	return (
		<PreviewFrame className={ styles.thumbnailFrame }>
			<PreviewImage src={ thumbnail } alt={ label } onError={ () => setFailedImage( thumbnail ) } />
		</PreviewFrame>
	);
}

export function ThumbnailTooltip( {
	trigger,
	thumbnail,
	label,
	children,
	side,
	disabled,
	onOpenChange,
}: {
	trigger: ReactElement;
	side: 'bottom' | 'inline-end';
	disabled?: boolean;
	onOpenChange?: ( open: boolean ) => void;
} & (
	| { thumbnail?: string | null; label: string; children?: never }
	| { children: ReactNode; thumbnail?: never; label?: never }
) ) {
	return (
		<Tooltip disabled={ disabled } onOpenChange={ onOpenChange }>
			<TooltipTrigger delay={ 150 } render={ trigger } />
			{ /* Mount the popup while loading so a closed tooltip can unmount. */ }
			<TooltipContent
				side={ side }
				align="start"
				sideOffset={ side === 'bottom' ? 6 : 12 }
				className={ styles.siteThumbnail }
			>
				{ children ??
					( label !== undefined && (
						<ThumbnailTooltipImage thumbnail={ thumbnail } label={ label } />
					) ) }
			</TooltipContent>
		</Tooltip>
	);
}
