import { clsx } from 'clsx';
import styles from './style.module.css';

type XdebugMotion = 'antennae' | 'both' | 'legs';
type XdebugCrawl = 'in' | 'out';

interface XdebugIconProps {
	active?: boolean;
	className?: string;
	crawl?: XdebugCrawl;
	interactive?: boolean;
	motion?: XdebugMotion;
}

export function XdebugIcon( {
	active = false,
	className,
	crawl,
	interactive = false,
	motion,
}: XdebugIconProps ) {
	return (
		<svg
			className={ clsx( styles.icon, className ) }
			viewBox="0 0 24 24"
			aria-hidden="true"
			focusable="false"
			data-active={ active || undefined }
			data-crawl={ crawl }
			data-interactive={ interactive || undefined }
			data-motion={ motion }
		>
			<g className={ styles.creature }>
				<path
					className={ styles.body }
					d="M9.699 10.421H14.5C14.965 10.421 15.342 10.798 15.342 11.263V14.631C15.342 16.492 13.891 18 12.1 18C10.309 18 8.858 16.492 8.858 14.631V11.263C8.858 10.798 9.235 10.421 9.699 10.421Z"
					fill="currentColor"
				/>
				<g className={ styles.legs }>
					<path className={ styles.legOne } d="M9.05 11.76L7.43 11.06" />
					<path className={ styles.legTwo } d="M9.06 14.75L7.51 15.64" />
					<path className={ styles.legThree } d="M15.15 11.76L16.77 11.06" />
					<path className={ styles.legFour } d="M15.14 14.75L16.69 15.64" />
				</g>
				<path
					className={ styles.head }
					d="M9.784 9.243C9.784 7.955 10.821 7.01 12.1 7.01C13.379 7.01 14.416 7.955 14.416 9.243C14.416 9.488 14.2 9.664 13.954 9.664H10.245C10 9.664 9.785 9.488 9.784 9.243Z"
					fill="currentColor"
				/>
				<g className={ styles.antennae }>
					<path className={ styles.antennaOne } d="M10.79 7.52L9.99 6.43" />
					<path className={ styles.antennaTwo } d="M13.4 7.5L14.12 6.43" />
				</g>
			</g>
		</svg>
	);
}
