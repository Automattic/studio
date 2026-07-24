/**
 * TEMP — design-only scenario control.
 *
 * A floating panel (dev builds only) that forces the settings UI signed-in or
 * signed-out, so we can eyeball how the account sidebar and agent tab adapt
 * without actually logging out.
 *
 * To remove: delete this file, drop `<SettingsPreviewPanel />` +
 * `SettingsPreviewProvider` from index.tsx, and swap the `usePreview*` hooks
 * back to `useAuthUser` / `useAgenticFeatures` in account-section.tsx and
 * usage-panel.tsx.
 */
import { createContext, useContext, useMemo, useState } from 'react';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useAuthUser } from '@/data/queries/use-auth-user';
import type { AuthUser } from '@/data/core';
import type { AgenticFeatures } from '@/data/queries/use-agentic-features';
import type { CSSProperties, ReactNode } from 'react';

export const SHOW_PREVIEW_CONTROLS = import.meta.env.DEV && import.meta.env.MODE !== 'test';

type AuthScenario = 'default' | 'in' | 'out';

interface PreviewOverrides {
	auth: AuthScenario;
}

const DEFAULT_OVERRIDES: PreviewOverrides = {
	auth: 'default',
};

const PREVIEW_USER: AuthUser = {
	id: 424242,
	displayName: 'Preview User',
	email: 'preview@example.com',
};

interface PreviewContextValue {
	overrides: PreviewOverrides;
	setOverride: ( key: keyof PreviewOverrides, value: string ) => void;
	reset: () => void;
	active: boolean;
}

const PreviewContext = createContext< PreviewContextValue >( {
	overrides: DEFAULT_OVERRIDES,
	setOverride: () => {},
	reset: () => {},
	active: false,
} );

export function SettingsPreviewProvider( { children }: { children: ReactNode } ) {
	const [ overrides, setOverrides ] = useState< PreviewOverrides >( DEFAULT_OVERRIDES );

	const value = useMemo< PreviewContextValue >(
		() => ( {
			overrides,
			setOverride: ( key, next ) =>
				setOverrides( ( prev ) => ( { ...prev, [ key ]: next } ) as PreviewOverrides ),
			reset: () => setOverrides( DEFAULT_OVERRIDES ),
			active: Object.values( overrides ).some( ( scenario ) => scenario !== 'default' ),
		} ),
		[ overrides ]
	);

	return <PreviewContext.Provider value={ value }>{ children }</PreviewContext.Provider>;
}

function usePreviewOverrides() {
	return useContext( PreviewContext );
}

// --- Override-aware wrappers around the real data hooks ---------------------

export function usePreviewAuthUser(): { data: AuthUser | null | undefined; isLoading: boolean } {
	const { overrides } = usePreviewOverrides();
	const { data, isLoading } = useAuthUser();

	if ( overrides.auth === 'in' ) {
		return { data: data ?? PREVIEW_USER, isLoading: false };
	}
	if ( overrides.auth === 'out' ) {
		return { data: null, isLoading: false };
	}
	return { data, isLoading };
}

export function usePreviewAgenticFeatures(): AgenticFeatures & { isReady: boolean } {
	const { overrides } = usePreviewOverrides();
	const real = useAgenticFeatures();

	if ( overrides.auth === 'out' ) {
		return { ...real, enabled: false, chatEnabled: false, reason: 'signed-out', isReady: true };
	}
	// Forcing signed-in only clears a signed-out reason — offline still wins.
	if ( overrides.auth === 'in' && real.reason === 'signed-out' ) {
		return { ...real, enabled: true, reason: null, isReady: true };
	}
	return real;
}

// --- Floating control panel -------------------------------------------------

const SCENARIO_GROUPS: {
	key: keyof PreviewOverrides;
	label: string;
	options: { value: string; label: string }[];
}[] = [
	{
		key: 'auth',
		label: 'Account',
		options: [
			{ value: 'default', label: 'Default' },
			{ value: 'in', label: 'Signed in' },
			{ value: 'out', label: 'Signed out' },
		],
	},
];

const panelStyle: CSSProperties = {
	position: 'fixed',
	insetBlockEnd: '16px',
	insetInlineEnd: '16px',
	zIndex: 9999,
	inlineSize: '244px',
	display: 'flex',
	flexDirection: 'column',
	gap: '12px',
	padding: '14px',
	borderRadius: '10px',
	border: '1px solid var(--wpds-color-stroke-surface-neutral)',
	background: 'var(--wpds-color-bg-surface-neutral)',
	color: 'var(--wpds-color-fg-content-neutral)',
	boxShadow: '0 8px 28px rgba(0, 0, 0, 0.24)',
	fontFamily: 'var(--wpds-typography-font-family-body)',
	fontSize: 'var(--wpds-typography-font-size-sm)',
};

const headerStyle: CSSProperties = {
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	gap: '8px',
};

const titleStyle: CSSProperties = {
	fontWeight: 600,
	fontSize: 'var(--wpds-typography-font-size-md)',
};

const hintStyle: CSSProperties = {
	margin: 0,
	color: 'var(--wpds-color-fg-content-neutral-weak)',
	fontSize: 'var(--wpds-typography-font-size-xs)',
	lineHeight: 'var(--wpds-typography-line-height-sm)',
};

const rowStyle: CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	gap: '5px',
};

const rowLabelStyle: CSSProperties = {
	color: 'var(--wpds-color-fg-content-neutral-weak)',
	fontSize: 'var(--wpds-typography-font-size-xs)',
	textTransform: 'uppercase',
	letterSpacing: '0.04em',
};

const segStyle: CSSProperties = {
	display: 'grid',
	gridTemplateColumns: 'repeat(3, 1fr)',
	gap: '3px',
	padding: '3px',
	borderRadius: 'var(--wpds-border-radius-sm)',
	background: 'var(--wpds-color-bg-interactive-neutral-weak)',
};

function segButtonStyle( selected: boolean ): CSSProperties {
	return {
		appearance: 'none',
		border: 0,
		borderRadius: 'var(--wpds-border-radius-sm)',
		padding: '4px 6px',
		fontSize: 'var(--wpds-typography-font-size-xs)',
		fontWeight: selected ? 600 : 400,
		lineHeight: 1.4,
		cursor: 'pointer',
		background: selected ? 'var(--wpds-color-fg-content-neutral)' : 'transparent',
		color: selected
			? 'var(--wpds-color-bg-surface-neutral)'
			: 'var(--wpds-color-fg-content-neutral-weak)',
	};
}

const iconButtonStyle: CSSProperties = {
	appearance: 'none',
	border: 0,
	background: 'transparent',
	color: 'var(--wpds-color-fg-content-neutral-weak)',
	cursor: 'pointer',
	fontSize: 'var(--wpds-typography-font-size-md)',
	lineHeight: 1,
	padding: '2px 4px',
};

const collapsedButtonStyle: CSSProperties = {
	...panelStyle,
	inlineSize: 'auto',
	flexDirection: 'row',
	alignItems: 'center',
	gap: '6px',
	padding: '8px 12px',
	cursor: 'pointer',
	fontWeight: 600,
};

export function SettingsPreviewPanel() {
	const { overrides, setOverride, reset, active } = usePreviewOverrides();
	const [ open, setOpen ] = useState( true );

	if ( ! open ) {
		return (
			<button type="button" style={ collapsedButtonStyle } onClick={ () => setOpen( true ) }>
				Scenarios{ active ? ' •' : '' }
			</button>
		);
	}

	return (
		<aside style={ panelStyle } aria-label="Preview scenarios">
			<div style={ headerStyle }>
				<span style={ titleStyle }>Preview scenarios</span>
				<div style={ { display: 'flex', alignItems: 'center', gap: '2px' } }>
					<button
						type="button"
						style={ { ...iconButtonStyle, opacity: active ? 1 : 0.4 } }
						disabled={ ! active }
						onClick={ reset }
					>
						Reset
					</button>
					<button
						type="button"
						style={ iconButtonStyle }
						aria-label="Hide preview scenarios"
						onClick={ () => setOpen( false ) }
					>
						×
					</button>
				</div>
			</div>
			<p style={ hintStyle }>Design-only. Not shown in production builds.</p>
			{ SCENARIO_GROUPS.map( ( group ) => (
				<div key={ group.key } style={ rowStyle }>
					<span style={ rowLabelStyle }>{ group.label }</span>
					<div style={ segStyle } role="group" aria-label={ group.label }>
						{ group.options.map( ( option ) => {
							const selected = overrides[ group.key ] === option.value;
							return (
								<button
									key={ option.value }
									type="button"
									aria-pressed={ selected }
									style={ segButtonStyle( selected ) }
									onClick={ () => setOverride( group.key, option.value ) }
								>
									{ option.label }
								</button>
							);
						} ) }
					</div>
				</div>
			) ) }
		</aside>
	);
}
