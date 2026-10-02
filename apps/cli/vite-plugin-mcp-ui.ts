import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { Plugin } from 'vite';

const MODULE_ID = 'virtual:mcp-ui';
const RESOLVED_ID = `\0${ MODULE_ID }`;
const mcpUiPath = resolve( import.meta.dirname, '../mcp-ui' );
const mcpUiHtmlPath = resolve( mcpUiPath, 'dist/index.html' );

// The MCP Apps front end (apps/mcp-ui), inlined as one HTML document, is
// imported from `virtual:mcp-ui`. CLI builds rebuild it first; tests read the
// last build, or a stub when there is none.
export function mcpUiPlugin(): Plugin {
	let building = false;
	return {
		name: 'mcp-ui',
		configResolved( config ) {
			building = config.command === 'build';
		},
		buildStart() {
			if ( building ) {
				execSync( 'npx vite build', { cwd: mcpUiPath, stdio: 'inherit' } );
			}
		},
		resolveId( id ) {
			return id === MODULE_ID ? RESOLVED_ID : undefined;
		},
		load( id ) {
			if ( id !== RESOLVED_ID ) {
				return undefined;
			}
			if ( ! existsSync( mcpUiHtmlPath ) ) {
				if ( building ) {
					throw new Error( `The MCP UI build did not produce ${ mcpUiHtmlPath }.` );
				}
				return 'export default "<!doctype html><title>WordPress</title>";';
			}
			this.addWatchFile( mcpUiHtmlPath );
			return `export default ${ JSON.stringify( readFileSync( mcpUiHtmlPath, 'utf8' ) ) };`;
		},
	};
}
