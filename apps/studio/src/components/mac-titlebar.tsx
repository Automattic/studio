import { useFullscreen } from 'src/hooks/use-fullscreen';
import { cx } from 'src/lib/cx';
import { isWindowFrameRtl } from 'src/lib/is-window-frame-rtl';

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
				'transition-[padding] duration-500 ease-in-out pb-2',
				! isFullscreen &&
					isRtl &&
					'ltr:pr-window-controls-width-excl-chrome-mac ltr:pl-chrome rtl:pr-window-controls-width-mac rtl:-ml-chrome',
				! isFullscreen &&
					! isRtl &&
					'ltr:pl-window-controls-width-mac rtl:pl-window-controls-width-excl-chrome-mac rtl:pr-chrome',
				isFullscreen && '',
				className
			) }
		>
			{ children }
		</div>
	);
}
