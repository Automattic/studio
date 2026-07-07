import type {
	ClipDocumentRect,
	ClipElementTarget,
	ClipGrain,
} from '@studio/common/inspector/protocol';

/**
 * A finished capture handed up by the webview surface, before `SitePreview`
 * decorates it with preview context (realm, viewport, color scheme) and a
 * localized display name to become a composer clip.
 */
export interface RawClipCapture {
	grain: ClipGrain;
	image?: File;
	comment?: string;
	target?: ClipElementTarget;
	documentRect?: ClipDocumentRect;
	zoom?: number;
	coveredTag?: string;
	coveredSelector?: string;
	url?: string;
	pathname?: string;
}

export type PreviewConsoleLevel = 'debug' | 'log' | 'info' | 'warning' | 'error';

export interface PreviewConsoleEntry {
	id: string;
	level: PreviewConsoleLevel;
	message: string;
	timestamp: number;
	sourceId?: string;
	lineNumber?: number;
}

export interface PreviewConsoleTextFile {
	name: string;
	contents: string;
	mimeType: 'text/plain';
	size: number;
}
