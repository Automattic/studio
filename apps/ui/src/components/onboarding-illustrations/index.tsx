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

export function DropBackupIllustration() {
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
			{ /* Mask that hides the portion of the back folder that sits under the
			     front square, so the back can drift behind without appearing
			     on top of the front outline. */ }
			<defs>
				<mask
					id="dropbackup-outside-front"
					maskUnits="userSpaceOnUse"
					maskContentUnits="userSpaceOnUse"
					x="0"
					y="0"
					width="198"
					height="110"
				>
					<rect x="0" y="0" width="198" height="110" fill="white" />
					<rect x="89.5" y="44.25" width="50" height="50" rx="10" fill="black" />
				</mask>
			</defs>
			<g mask="url(#dropbackup-outside-front)">
				<path
					className={ styles.cardShift }
					d="M98 15C103.523 15 108 19.4772 108 25V39.9561H104V25C104 21.6863 101.314 19 98 19H68C64.6863 19 62 21.6863 62 25V55C62 58.3137 64.6863 61 68 61H84.8633V65H68L67.4854 64.9873C62.3721 64.7281 58.2719 60.6279 58.0127 55.5146L58 55V25C58 19.4772 62.4772 15 68 15H98ZM108 48.9561V55C108 60.3502 103.798 64.7195 98.5146 64.9873L98 65H93.8633V61H98C101.314 61 104 58.3137 104 55V48.9561H108Z"
					fill={ STROKE }
					fillOpacity="0.6"
				/>
			</g>
			<rect
				x="89.5"
				y="44.25"
				width="50"
				height="50"
				rx="10"
				stroke={ STROKE }
				strokeWidth="4"
				className={ styles.themeStroke }
			/>
			<circle
				cx="115"
				cy="69.5"
				r="5.5"
				stroke={ STROKE }
				strokeLinecap="round"
				strokeDasharray="1 5"
				className={ styles.spin }
			/>
		</svg>
	);
}
