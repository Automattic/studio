import { useFullscreen } from '../hooks/use-fullscreen';
import { cx } from '../lib/cx';
import { isWindowFrameRtl } from '../lib/is-window-frame-rtl';

export default function MacTitlebar( {
	className,
	children,
}: {
	className?: string;
	children?: React.ReactNode;
} ) {
	const isFullscreen = useFullscreen();
	const isRtl = isWindowFrameRtl();

	return (
		<div
			className={ cx(
				'transition-[padding] duration-500 ease-in-out',
				! isFullscreen &&
					isRtl &&
					'ltr:pr-window-controls-width-excl-chrome-mac ltr:pl-chrome rtl:pr-window-controls-width-mac rtl:-ml-chrome',
				! isFullscreen &&
					! isRtl &&
					'ltr:pl-window-controls-width-mac rtl:pl-window-controls-width-excl-chrome-mac rtl:pr-chrome',
				isFullscreen && 'ltr:pl-4 rtl:pr-4',
				className
			) }
		>
			{ children }
		</div>
	);
}
