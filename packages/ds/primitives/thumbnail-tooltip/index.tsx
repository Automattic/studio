import { useState, type ReactElement } from 'react';
import { PreviewFrame, PreviewImage } from '../preview-frame';
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip';
import styles from './style.module.css';

export function ThumbnailTooltip( {
	trigger,
	thumbnail,
	label,
	side,
	disabled,
	onOpenChange,
}: {
	trigger: ReactElement;
	thumbnail?: string | null;
	label: string;
	side: 'bottom' | 'inline-end';
	disabled?: boolean;
	onOpenChange?: ( open: boolean ) => void;
} ) {
	const [ failedImage, setFailedImage ] = useState< string >();
	return (
		<Tooltip disabled={ disabled } onOpenChange={ onOpenChange }>
			<TooltipTrigger delay={ 150 } render={ trigger } />
			{ thumbnail && thumbnail !== failedImage && (
				<TooltipContent
					side={ side }
					align="start"
					sideOffset={ side === 'bottom' ? 6 : 12 }
					className={ styles.siteThumbnail }
				>
					<PreviewFrame className={ styles.thumbnailFrame }>
						<PreviewImage
							src={ thumbnail }
							alt={ label }
							onError={ () => setFailedImage( thumbnail ) }
						/>
					</PreviewFrame>
				</TooltipContent>
			) }
		</Tooltip>
	);
}
