import path from 'node:path';
import type { EffectivePanelLayout, PanelLayoutOverrides } from './layout.ts';
import type { CapturePreset, ScenarioId, Theme } from './presets.ts';

export const MANIFEST_SCHEMA_VERSION = 2;

export interface GitMetadata {
	commit: string;
	dirty: boolean;
}

export interface CaptureDiagnostics {
	consoleErrors: string[];
	pageErrors: string[];
	failedRequests: string[];
	unexpectedExternalRequests: string[];
}

export interface CaptureManifestEntry {
	scenario: ScenarioId;
	theme: Theme;
	preset: string;
	captureTier: 'renderer';
	hostProfile: 'browser';
	simulatedHost: true;
	applicationMode: 'browser';
	logicalViewport: CapturePreset[ 'viewport' ];
	deviceScaleFactor: number;
	outputDimensions: CapturePreset[ 'output' ];
	composition: {
		crop: 'none';
		padding: 'none';
		background: 'application';
		shadow: 'none';
	};
	relativePath: string;
	readyMarker: string;
	fileSizeBytes: number;
	panelLayout: {
		requested: PanelLayoutOverrides;
		effective: EffectivePanelLayout;
	};
	diagnostics: CaptureDiagnostics;
}

export interface CaptureManifest {
	schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
	generatedAt: string;
	studio: GitMetadata;
	syntheticData: true;
	determinism: {
		fixedClock: string;
		locale: 'en-US';
		timeZone: 'UTC';
		reducedMotion: true;
	};
	source: {
		distDirectory: string;
	};
	captures: CaptureManifestEntry[];
}

interface CreateManifestOptions {
	generatedAt: string;
	git: GitMetadata;
	distDirectory: string;
	fixedClock: string;
	captures: CaptureManifestEntry[];
}

export function createManifest( options: CreateManifestOptions ): CaptureManifest {
	return {
		schemaVersion: MANIFEST_SCHEMA_VERSION,
		generatedAt: options.generatedAt,
		studio: options.git,
		syntheticData: true,
		determinism: {
			fixedClock: options.fixedClock,
			locale: 'en-US',
			timeZone: 'UTC',
			reducedMotion: true,
		},
		source: {
			distDirectory: options.distDirectory,
		},
		captures: options.captures,
	};
}

export function getCaptureRelativePath(
	scenario: ScenarioId,
	theme: Theme,
	presetId: string
): string {
	return path.posix.join( scenario, 'renderer', theme, `${ presetId }.png` );
}

export function renderContactSheet( manifest: CaptureManifest ): string {
	const cards = manifest.captures
		.map( ( capture ) => {
			const label = `${ capture.scenario } · ${ capture.theme } · ${ capture.preset }`;
			const dimensions = `${ capture.outputDimensions.width } × ${ capture.outputDimensions.height }`;

			return `
				<figure>
					<a href="${ escapeHtml( capture.relativePath ) }">
						<img src="${ escapeHtml( capture.relativePath ) }" alt="${ escapeHtml( label ) }" loading="lazy">
					</a>
					<figcaption>
						<strong>${ escapeHtml( label ) }</strong>
						<span>${ escapeHtml( dimensions ) }</span>
					</figcaption>
				</figure>`;
		} )
		.join( '\n' );

	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<title>Studio marketing screenshot contact sheet</title>
		<style>
			:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
			body { margin: 0; padding: 32px; background: Canvas; color: CanvasText; }
			header { margin-block-end: 32px; }
			h1 { margin: 0 0 8px; font-size: 28px; }
			p { margin: 0; color: color-mix(in srgb, CanvasText 65%, transparent); }
			.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 24px; }
			figure { margin: 0; overflow: hidden; border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius: 8px; background: Canvas; }
			a { display: block; background: #8882; }
			img { display: block; width: 100%; height: auto; }
			figcaption { display: flex; justify-content: space-between; gap: 16px; padding: 12px 14px; font-size: 13px; }
			figcaption span { white-space: nowrap; opacity: 0.7; }
		</style>
	</head>
	<body>
		<header>
			<h1>Studio marketing screenshots</h1>
			<p>Commit ${ escapeHtml( manifest.studio.commit ) }${
				manifest.studio.dirty ? ' (dirty)' : ''
			} · Generated ${ escapeHtml( manifest.generatedAt ) } · Synthetic scenario data</p>
		</header>
		<main class="grid">${ cards }
		</main>
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
