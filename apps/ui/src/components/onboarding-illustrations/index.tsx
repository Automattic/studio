import styles from './style.module.css';

const STROKE = 'var(--wpds-color-fg-content-neutral)';

export const illustrationHostClass = styles.host;

export function BuildNewSiteIllustration() {
	return (
		<svg
			width="198"
			height="110"
			viewBox="0 0 198 110"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			data-keep-size
		>
			<circle
				cx="99"
				cy="55.5"
				r="36"
				stroke={ STROKE }
				strokeWidth="4"
				strokeLinecap="round"
				className={ styles.themeStroke }
			/>
			<circle
				cx="99"
				cy="55.5"
				r="28.75"
				stroke={ STROKE }
				strokeWidth="0.5"
				strokeLinecap="round"
				strokeDasharray="6 6"
				className={ styles.hoverSpinReverse }
			/>
			<circle
				cx="99"
				cy="55.5"
				r="5.5"
				stroke={ STROKE }
				strokeLinecap="round"
				strokeDasharray="1 5"
				className={ styles.spin }
			/>
		</svg>
	);
}
