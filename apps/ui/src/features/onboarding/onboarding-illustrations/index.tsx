import styles from './style.module.css';

const STROKE = 'var(--foreground)';

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
