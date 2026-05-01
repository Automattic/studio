// Electron's `<webview>` tag, used by the site-preview surface. Only the
// attributes we actually set are typed; the runtime API (`loadURL`,
// `executeJavaScript`, `console-message`) is accessed through a local
// interface in apps/ui/src/components/site-preview/index.tsx.
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
