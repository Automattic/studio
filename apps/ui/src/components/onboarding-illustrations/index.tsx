import styles from './style.module.css';

const STROKE = 'var(--wpds-color-foreground-content-neutral)';

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

export function ConnectSiteIllustration() {
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
				cy="45"
				r="5.5"
				stroke={ STROKE }
				strokeLinecap="round"
				strokeDasharray="1 5"
				className={ styles.spin }
			/>
			<path
				className={ styles.arrowNudge }
				d="M100.75 58C100.75 57.0335 99.9665 56.25 99 56.25C98.0335 56.25 97.25 57.0335 97.25 58H99H100.75ZM97.7626 92.2374C98.446 92.9209 99.554 92.9209 100.237 92.2374L111.374 81.1005C112.058 80.4171 112.058 79.309 111.374 78.6256C110.691 77.9422 109.583 77.9422 108.899 78.6256L99 88.5251L89.1005 78.6256C88.4171 77.9422 87.309 77.9422 86.6256 78.6256C85.9422 79.309 85.9422 80.4171 86.6256 81.1005L97.7626 92.2374ZM99 58H97.25L97.25 91L99 91L100.75 91L100.75 58H99Z"
				fill={ STROKE }
			/>
			<path
				className={ styles.themeFill }
				d="M131 24C135.418 24 139 27.5817 139 32V59C139 63.4183 135.418 67 131 67H103V63H131L131.206 62.9951C133.319 62.8879 135 61.14 135 59V32C135 29.86 133.319 28.1121 131.206 28.0049L131 28H67C64.7909 28 63 29.7909 63 32V59L63.0049 59.2061C63.1121 61.3194 64.86 63 67 63H95V67H67C62.5817 67 59 63.4183 59 59V32C59 27.5817 62.5817 24 67 24H131Z"
				fill={ STROKE }
			/>
		</svg>
	);
}

export function SiteListIllustration() {
	return (
		<svg
			width="200"
			height="130"
			viewBox="0 0 200 130"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			data-keep-size
		>
			<rect x="2" y="2" width="196" height="126" rx="12" stroke={ STROKE } strokeWidth="4" />
			<rect x="20" y="27" width="76" height="8" rx="4" fill={ STROKE } fillOpacity="0.2" />
			<rect x="20" y="61" width="98" height="8" rx="4" fill={ STROKE } fillOpacity="0.2" />
			<rect x="20" y="95" width="58" height="8" rx="4" fill={ STROKE } fillOpacity="0.2" />
			<circle cx="176" cy="31" r="4" fill="#16a34a" />
			{ /* Starting site: dashed ring spins while the dot pulses amber, then
			     both resolve into the steady running green as the ping fires. */ }
			<circle
				cx="176"
				cy="65"
				r="8"
				stroke={ STROKE }
				strokeLinecap="round"
				strokeDasharray="1 5"
				className={ styles.startingRing }
			/>
			<circle
				cx="176"
				cy="65"
				r="6"
				stroke="#16a34a"
				strokeWidth="2"
				className={ styles.startupPing }
			/>
			<circle cx="176" cy="65" r="4" className={ styles.startingDot } />
			<circle cx="176" cy="99" r="4" fill="#16a34a" />
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
