/**
 * Opens a headed Playwright browser on a Studio site with the Agentation
 * annotation toolbar injected via dynamic imports from esm.sh.
 *
 * Uses ?deps= pinning to ensure a single React instance shared with Agentation.
 */

const AGENTATION_ENDPOINT = 'http://localhost:4747';

type Browser = Awaited< ReturnType< ( typeof import('playwright') )[ 'chromium' ][ 'launch' ] > >;
type Page = Awaited< ReturnType< Browser[ 'newPage' ] > >;

let agentationBrowser: Browser | null = null;
let agentationPage: Page | null = null;

export async function openAgentationBrowser( siteUrl: string ): Promise< string > {
	if ( agentationBrowser && agentationPage ) {
		try {
			await agentationPage.evaluate( () => true );
			return 'Agentation browser is already open. The user can annotate elements.';
		} catch {
			agentationBrowser = null;
			agentationPage = null;
		}
	}

	const { chromium } = await import( 'playwright' );
	agentationBrowser = await chromium.launch( {
		headless: false,
		args: [ '--ignore-certificate-errors' ],
	} );

	agentationPage = await agentationBrowser.newPage( {
		viewport: { width: 1440, height: 900 },
		ignoreHTTPSErrors: true,
	} );

	await agentationPage.goto( siteUrl, {
		waitUntil: 'domcontentloaded',
		timeout: 30_000,
	} );

	await agentationPage.waitForLoadState( 'networkidle', { timeout: 10_000 } ).catch( () => {} );

	const injectScript = [
		'import("https://esm.sh/react@18").then(function(R) {',
		'return import("https://esm.sh/react-dom@18/client?deps=react@18").then(function(RD) {',
		'return import("https://esm.sh/agentation@3?deps=react@18,react-dom@18").then(function(Ag) {',
		'var c = document.createElement("div"); c.id = "__agentation-root"; document.body.appendChild(c);',
		'RD.createRoot(c).render(R.default.createElement(Ag.PageFeedbackToolbarCSS,',
		'{ endpoint: "' + AGENTATION_ENDPOINT + '" }));',
		'}); }); });',
	].join( ' ' );

	await agentationPage.evaluate( injectScript );

	agentationPage.on( 'close', () => {
		agentationBrowser = null;
		agentationPage = null;
	} );

	return `Agentation browser opened at ${ siteUrl }. Click the circle icon in the bottom-right to annotate elements.`;
}
