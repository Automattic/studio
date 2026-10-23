import type { ComponentProps } from 'react';

export function IntelligenceIcon( props: ComponentProps< 'svg' > ) {
	return (
		<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" { ...props }>
			<path
				d="M20.6867 3.32301C20.2623 2.89072 19.992 2.25667 19.8885 1.37008V1H19.1115V1.36968C19.0044 2.27111 18.7342 2.89103 18.3126 3.31259C17.891 3.73415 17.2711 4.00442 16.3697 4.11154H16V4.88846H16.3701C17.2567 4.99203 17.8907 5.26226 18.323 5.68673C18.7537 6.10963 19.0293 6.73014 19.1115 7.62517V8H19.8885V7.62473C19.9674 6.74444 20.2428 6.10989 20.6763 5.67634C21.1099 5.24278 21.7444 4.96737 22.6247 4.88846H23V4.11154H22.6252C21.7301 4.02931 21.1096 3.7537 20.6867 3.32301Z"
				fill="currentColor"
			/>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M2 13C8.25 13 11 10.25 11 4C11 10.25 13.75 13 20 13C13.75 13 11 15.75 11 22C11 15.75 8.25 13 2 13Z"
				stroke="currentColor"
				strokeWidth="2"
			/>
		</svg>
	);
}
