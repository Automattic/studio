import { cx } from '../lib/cx';
import { isWindowFrameRtl } from '../lib/is-window-frame-rtl';

export default function MacTitlebar( {
	className,
	children,
}: {
	className?: string;
	children?: React.ReactNode;
} ) {
	return (
		<div
			className={ cx(
				// Leave space for window controls depending on which side they are on
				// Take into account the "chrome" padding, the position of which depends on the language direction
				isWindowFrameRtl() &&
					'ltr:pr-window-controls-width-excl-chrome-mac ltr:pl-chrome rtl:pr-window-controls-width-mac rtl:-ml-chrome',
				! isWindowFrameRtl() &&
					'ltr:pl-window-controls-width-mac rtl:pl-window-controls-width-excl-chrome-mac rtl:pr-chrome',
				className
			) }
		>
			{ children }
		</div>
	);
}
