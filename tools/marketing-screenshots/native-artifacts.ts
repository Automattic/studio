import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CapturePreset, Theme } from './presets.ts';

export interface NativeCaptureEntry {
	name: string;
	relativePath: string;
}

interface NativeReviewArtifactsOptions {
	outputDirectory: string;
	theme: Theme;
	preset: CapturePreset;
	captures: NativeCaptureEntry[];
}

export async function writeNativeReviewArtifacts(
	options: NativeReviewArtifactsOptions
): Promise< void > {
	const generatedAt = new Date().toISOString();
	await Promise.all( [
		writeFile(
			path.join( options.outputDirectory, 'manifest.json' ),
			`${ JSON.stringify(
				{
					schemaVersion: 1,
					generatedAt,
					captureTier: 'native-electron',
					captureMethod: 'BrowserWindow.webContents.capturePage',
					previewRuntime: 'isolated-real-wordpress',
					theme: options.theme,
					preset: options.preset.id,
					logicalViewport: options.preset.viewport,
					outputDimensions: options.preset.output,
					captures: options.captures,
				},
				null,
				2
			) }\n`
		),
		writeFile(
			path.join( options.outputDirectory, 'contact-sheet.html' ),
			renderNativeContactSheet( { ...options, generatedAt } )
		),
	] );
}

export function renderNativeContactSheet(
	options: NativeReviewArtifactsOptions & { generatedAt: string }
): string {
	const cards = options.captures
		.map( ( capture ) => {
			const label = capture.name.replaceAll( '-', ' ' );
			return `<figure>
			<a href="${ escapeHtml( capture.relativePath ) }"><img src="${ escapeHtml(
				capture.relativePath
			) }" alt="${ escapeHtml( label ) }" loading="lazy"></a>
			<figcaption><strong>${ escapeHtml( label ) }</strong><span>${ options.preset.output.width } × ${
				options.preset.output.height
			}</span></figcaption>
		</figure>`;
		} )
		.join( '\n' );

	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<title>Studio native annotation screenshots</title>
		<style>
			:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
			* { box-sizing: border-box; }
			body { margin: 0; padding: 32px; color: CanvasText; background: Canvas; }
			header { margin-block-end: 32px; }
			h1 { margin: 0 0 8px; font-size: 28px; }
			p { margin: 0; opacity: 0.7; }
			.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 520px), 1fr)); gap: 24px; }
			figure { min-width: 0; margin: 0; overflow: hidden; border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius: 8px; background: Canvas; }
			a { display: block; background: #8882; }
			img { display: block; width: 100%; height: auto; }
			figcaption { display: flex; justify-content: space-between; gap: 16px; padding: 12px 14px; font-size: 13px; text-transform: capitalize; }
			figcaption span { flex: none; opacity: 0.7; }
		</style>
	</head>
	<body>
		<header>
			<h1>Studio native annotation screenshots</h1>
			<p>Real isolated WordPress · Electron composed-window capture · ${ escapeHtml(
				options.theme
			) } · Generated ${ escapeHtml( options.generatedAt ) }</p>
		</header>
		<main class="grid">${ cards }</main>
	</body>
</html>
`;
}

function escapeHtml( value: string ): string {
	return value.replace( /[&<>"']/g, ( character ) => {
		const entities: Record< string, string > = {
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			'"': '&quot;',
			"'": '&#039;',
		};
		return entities[ character ];
	} );
}
