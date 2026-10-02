// MCP App (the `ui://` extension) that shows present_design_options' previews
// in the host's conversation; a click sends the pick as the user's message.
export const DESIGN_OPTIONS_APP_URI = 'ui://wordpress-studio/design-options.html';
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

export const DESIGN_OPTIONS_APP_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
	:root { color-scheme: light dark; --bg: #fff; --fg: #1e1e1e; --muted: #757575; --border: #ddd; --accent: #3858e9; }
	@media (prefers-color-scheme: dark) { :root { --bg: #1e1e1e; --fg: #f0f0f0; --muted: #a0a0a0; --border: #3c3c3c; --accent: #7b90ff; } }
	body { margin: 0; padding: 12px; font: 14px/1.45 system-ui, sans-serif; background: var(--bg); color: var(--fg); }
	h1 { font-size: 15px; margin: 0 0 12px; }
	main { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
	button { all: unset; box-sizing: border-box; min-width: 0; overflow: hidden; cursor: pointer; display: block; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
	button:hover, button:focus-visible { border-color: var(--accent); outline: 2px solid var(--accent); outline-offset: -2px; }
	button[aria-pressed="true"] { border-color: var(--accent); outline: 2px solid var(--accent); outline-offset: -2px; }
	img { display: block; width: 100%; height: auto; }
	span { display: block; padding: 8px 10px; }
	small { color: var(--muted); }
	footer { margin-top: 12px; }
</style>
</head>
<body hidden>
<h1 id="question"></h1>
<main id="options"></main>
<footer><button id="other"><span>Show other options</span></button></footer>
<script>
let nextId = 0;
const pending = new Map();
function request( method, params ) {
	const id = ++nextId;
	window.parent.postMessage( { jsonrpc: '2.0', id, method, params }, '*' );
	return new Promise( ( resolve ) => pending.set( id, resolve ) );
}
function say( text ) {
	return request( 'ui/message', { role: 'user', content: [ { type: 'text', text } ] } );
}
// Some hosts (Codex) pass the tool result wrapped as JSON text.
function optionsFrom( result ) {
	if ( ! result ) return null;
	if ( result.structuredContent && Array.isArray( result.structuredContent.options ) ) return result.structuredContent;
	for ( const block of result.content || [] ) {
		if ( block.type !== 'text' ) continue;
		try {
			const found = optionsFrom( JSON.parse( block.text ) );
			if ( found ) return found;
		} catch ( error ) {}
	}
	return null;
}
function render( data ) {
	if ( ! data || ! Array.isArray( data.options ) ) return;
	document.body.hidden = false;
	document.getElementById( 'question' ).textContent = data.question || '';
	const list = document.getElementById( 'options' );
	list.replaceChildren();
	data.options.forEach( ( option, index ) => {
		const button = document.createElement( 'button' );
		const image = document.createElement( 'img' );
		image.src = option.image;
		image.alt = '';
		const label = document.createElement( 'span' );
		label.innerHTML = '<strong></strong><br><small></small>';
		label.querySelector( 'strong' ).textContent = ( index + 1 ) + '. ' + option.label;
		label.querySelector( 'small' ).textContent = option.description;
		button.append( image, label );
		button.addEventListener( 'click', () => {
			list.querySelectorAll( 'button' ).forEach( ( b ) => b.setAttribute( 'aria-pressed', 'false' ) );
			button.setAttribute( 'aria-pressed', 'true' );
			say( 'I pick option ' + ( index + 1 ) + ': ' + option.label );
		} );
		list.append( button );
	} );
}
document.getElementById( 'other' ).addEventListener( 'click', () => say( 'Show other options' ) );
window.addEventListener( 'message', ( event ) => {
	const message = event.data;
	if ( ! message || message.jsonrpc !== '2.0' ) return;
	if ( message.id !== undefined && pending.has( message.id ) ) {
		pending.get( message.id )( message.result );
		pending.delete( message.id );
		return;
	}
	if ( message.method === 'ui/notifications/tool-result' ) {
		render( optionsFrom( message.params ) );
	}
} );
request( 'ui/initialize', {
	appInfo: { name: 'wordpress-studio-design-options', version: '1.0.0' },
	appCapabilities: {},
	protocolVersion: '2026-01-26',
} ).then( () => window.parent.postMessage( { jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*' ) );
</script>
</body>
</html>`;
