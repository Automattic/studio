export const StudioCodeTabImage = () => (
	<svg
		width="220"
		height="200"
		viewBox="0 0 220 200"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
	>
		<style>
			{ `
				.scti-card { fill: var(--color-frame-surface); }
				.scti-dot { fill: var(--color-frame-text); fill-opacity: 0.3; }
				.scti-bubble-in { fill: var(--color-frame-text); fill-opacity: 0.08; }
				.scti-line { fill: var(--color-frame-text); fill-opacity: 0.25; }
				.scti-line-light { fill: white; fill-opacity: 0.7; }
			` }
		</style>

		<g filter="url(#scti-shadow)">
			<rect x="24" y="34" width="172" height="132" rx="10" className="scti-card" />
		</g>

		<circle cx="42" cy="52" r="2.5" className="scti-dot" />
		<circle cx="50" cy="52" r="2.5" className="scti-dot" />
		<circle cx="58" cy="52" r="2.5" className="scti-dot" />

		<rect x="40" y="72" width="92" height="24" rx="12" className="scti-bubble-in" />
		<rect x="52" y="81" width="68" height="4" rx="2" className="scti-line" />

		<rect x="40" y="104" width="64" height="18" rx="9" className="scti-bubble-in" />
		<rect x="52" y="111" width="40" height="4" rx="2" className="scti-line" />

		<rect x="92" y="132" width="88" height="24" rx="12" fill="#3858E9" />
		<rect x="104" y="141" width="64" height="4" rx="2" className="scti-line-light" />

		<path
			d="M178 24C178 29 174 34 166 36C174 38 178 43 178 48C178 43 182 38 190 36C182 34 178 29 178 24Z"
			fill="#3858E9"
		/>

		<circle cx="36" cy="120" r="4" fill="#01C404" />
		<circle cx="194" cy="150" r="3.5" className="scti-dot" />

		<defs>
			<filter
				id="scti-shadow"
				x="14"
				y="28"
				width="192"
				height="152"
				filterUnits="userSpaceOnUse"
				colorInterpolationFilters="sRGB"
			>
				<feFlood floodOpacity="0" result="BackgroundImageFix" />
				<feColorMatrix
					in="SourceAlpha"
					type="matrix"
					values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
					result="hardAlpha"
				/>
				<feOffset dy="3" />
				<feGaussianBlur stdDeviation="5" />
				<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.08 0" />
				<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow" />
				<feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
			</filter>
		</defs>
	</svg>
);
