import { clsx } from 'clsx';
import styles from './style.module.css';
import type { GuideIllustrationId } from '@/data/onboarding/guide';
import type { CSSProperties, ReactNode } from 'react';

// Shared building blocks for the illustration scenes. Motion is never baked in
// here — each primitive takes a `style` the scene computes from the timeline, so
// the same pieces compose into any choreography.

// The full-bleed header slot every illustration fills: a fixed aspect ratio so
// the popup header keeps a stable height, and a positioning context for the
// scene. Each scene owns its own background and (if needed) color-scheme scope.
export function Stage( { id, children }: { id: GuideIllustrationId; children: ReactNode } ) {
	return (
		<div className={ styles.stage } data-illustration={ id }>
			{ children }
		</div>
	);
}

// A pointer used to demonstrate interactions. Position/scale/opacity come from
// the scene via `style`. The macOS look — black fill, thick rounded white
// border — reads clearly on any background.
export function Cursor( { className, style }: { className?: string; style?: CSSProperties } ) {
	return (
		<svg
			className={ className }
			style={ style }
			width="18"
			height="22"
			viewBox="0 0 20 25"
			fill="none"
			aria-hidden="true"
		>
			<path
				d="M3 2 L3 21 L8 16.5 L11 23 L14 21.8 L10.8 15.5 L17 15.3 Z"
				fill="#000"
				stroke="#fff"
				strokeWidth="2"
				strokeLinejoin="round"
				strokeLinecap="round"
				paintOrder="stroke"
			/>
		</svg>
	);
}

// A tooltip pill. The scene controls visibility/lift through `style` (opacity +
// transform) and placement through `className`.
export function Tooltip( {
	className,
	style,
	children,
}: {
	className?: string;
	style?: CSSProperties;
	children: ReactNode;
} ) {
	return (
		<span className={ clsx( styles.tooltip, className ) } style={ style }>
			{ children }
		</span>
	);
}

// Renders the first `count` characters of `text`, with a blinking caret while
// still streaming. Used for both the typed prompt and the streamed reply.
export function StreamingText( {
	text,
	count,
	className,
	caretClassName,
}: {
	text: string;
	count: number;
	className?: string;
	caretClassName?: string;
} ) {
	return (
		<span className={ className }>
			{ text.slice( 0, count ) }
			{ count < text.length ? <span className={ caretClassName } /> : null }
		</span>
	);
}

// Small inline glyphs for the mock composer and tool chip in the chat scenes.
export function PlusGlyph() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path
				d="M8 3.5 V12.5 M3.5 8 H12.5"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
		</svg>
	);
}

export function SendGlyph() {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path
				d="M8 12.5 V4 M4.5 7.5 L8 4 L11.5 7.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function FileGlyph() {
	return (
		<svg className={ styles.toolIcon } viewBox="0 0 16 16" aria-hidden="true">
			<path
				d="M4 2 H9 L12.5 5.5 V14 H4 Z M9 2 V5.5 H12.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.1"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function CameraGlyph() {
	return (
		<svg className={ styles.toolIcon } viewBox="0 0 16 16" aria-hidden="true">
			<path
				d="M2.5 5.5 H5 L6 3.5 H10 L11 5.5 H13.5 V12.5 H2.5 Z"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.1"
				strokeLinejoin="round"
			/>
			<circle cx="8" cy="9" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.1" />
		</svg>
	);
}

export function CheckGlyph() {
	return (
		<svg className={ styles.toolIcon } viewBox="0 0 16 16" aria-hidden="true">
			<path
				d="M3.5 8.5 L6.5 11.5 L12.5 4.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.3"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
