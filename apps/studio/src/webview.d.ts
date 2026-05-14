import 'react';

declare module 'react' {
	namespace JSX {
		interface IntrinsicElements {
			webview: React.DetailedHTMLProps< React.HTMLAttributes< HTMLElement >, HTMLElement > & {
				src?: string;
				allowpopups?: string;
				partition?: string;
				preload?: string;
				nodeintegration?: string;
				webpreferences?: string;
			};
		}
	}
}
