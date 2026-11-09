import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createPreviewDots } from '../apps/ui/src/features/sites/preview-particles/frame.ts';
import { dmgLayout } from './dmg-layout.ts';

async function generateBackground() {
	const root = path.resolve( import.meta.dirname, '..' );
	const assets = path.join( root, 'apps/studio/assets' );
	const { width, height } = dmgLayout;
	const browser = await chromium.launch();

	try {
		const page = await browser.newPage();
		await page.setContent(
			`<style>${ await fs.readFile(
				path.join( root, 'apps/ui/src/lib/theme/tokens.css' ),
				'utf8'
			) }</style>`
		);
		const colors = await page.evaluate( () => {
			const style = getComputedStyle( document.documentElement );
			return Object.fromEntries(
				[ 'background', 'foreground', 'muted-foreground', 'preview-dot' ].map( ( name ) => [
					name,
					style.getPropertyValue( `--${ name }` ),
				] )
			);
		} );
		const font = await fs.readFile(
			path.join(
				root,
				'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'
			)
		);
		const dots = createPreviewDots( width, height ).map(
			( dot ) => `<circle cx="${ dot.x.toFixed( 2 ) }" cy="${ dot.y.toFixed( 2 ) }" r="1"/>`
		);
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ width }" height="${ height }" viewBox="0 0 ${ width } ${ height }">
	<title>Install WordPress Studio</title>
	<desc>Studio's regular dot grid behind a horizontal drag-to-Applications layout.</desc>
	<style>
		:root { color-scheme: light; ${ Object.entries( colors )
			.map( ( [ name, value ] ) => `--${ name }: ${ value };` )
			.join( ' ' ) } }
		text { font-family: Inter, sans-serif; }
	</style>
	<rect width="${ width }" height="${ height }" fill="var(--background)"/>
	<g fill="var(--preview-dot)" opacity=".5">${ dots.join( '\n' ) }</g>
	<text x="${
		width / 2
	}" y="70" text-anchor="middle" font-size="16" fill="var(--foreground)">To install, drag <tspan font-weight="500">WordPress Studio</tspan> to <tspan font-weight="500">Applications</tspan></text>
	<g fill="none" stroke="var(--muted-foreground)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
		<path d="M356 212l8 8-8 8" opacity=".3"/>
		<path d="M376 212l8 8-8 8" opacity=".6"/>
		<path d="M396 212l8 8-8 8"/>
	</g>
</svg>
`;
		await fs.writeFile( path.join( assets, 'dmg-background.svg' ), svg );
		await page.close();
		for ( const scale of [ 1, 2 ] ) {
			const context = await browser.newContext( {
				viewport: { width, height },
				deviceScaleFactor: scale,
			} );
			const render = await context.newPage();
			await render.setContent(
				`<style>body { margin: 0; } @font-face { font-family: Inter; src: url(data:font/woff2;base64,${ font.toString(
					'base64'
				) }) format('woff2'); font-weight: 100 900; }</style>${ svg }`
			);
			await render.evaluate( () => document.fonts.ready );
			await render.screenshot( {
				path: path.join( assets, `dmg-background${ scale === 2 ? '@2x' : '' }.png` ),
			} );
			await context.close();
		}
	} finally {
		await browser.close();
	}
}

generateBackground().catch( ( error: unknown ) => {
	console.error( error );
	process.exitCode = 1;
} );
