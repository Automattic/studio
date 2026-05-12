import type { ReactElement } from 'react';

export interface ColorControlOption< TValue extends string = string > {
	value: TValue;
	label: string;
	color: string;
}

type StringControlPropKey< TProps extends Record< string, unknown > > = {
	[ TKey in Extract< keyof TProps, string > ]: TProps[ TKey ] extends string ? TKey : never;
}[ Extract< keyof TProps, string > ];

export type ColorControlConfig<
	TProps extends Record< string, unknown > = Record< string, string >,
> = {
	[ TProperty in StringControlPropKey< TProps > ]: {
		type: 'color';
		id: string;
		property: TProperty;
		label: string;
		options: Array< ColorControlOption< Extract< TProps[ TProperty ], string > > >;
	};
}[ StringControlPropKey< TProps > ];

export interface ControlRenderContext<
	TProps extends Record< string, unknown > = Record< string, unknown >,
> {
	isOpen: boolean;
	setIsOpen: ( isOpen: boolean ) => void;
	fitSelectedWidgetToContent?: () => Promise< boolean >;
	updateProps: ( props: Record< string, unknown > ) => void;
	props: TProps;
}

type CustomControlComponent< TProps extends Record< string, unknown > > = {
	bivarianceHack( props: ControlRenderContext< TProps > ): ReactElement | null;
}[ 'bivarianceHack' ];

export interface CustomControlConfig<
	TProps extends Record< string, unknown > = Record< string, unknown >,
> {
	type: 'custom';
	id: string;
	Component: CustomControlComponent< TProps >;
}

export type ControlConfig< TProps extends Record< string, unknown > = Record< string, string > > =
	| ColorControlConfig< TProps >
	| CustomControlConfig< TProps >;

export interface AnyColorControlConfig {
	type: 'color';
	id: string;
	property: string;
	label: string;
	options: Array< ColorControlOption< string > >;
}

export type AnyControlConfig =
	| AnyColorControlConfig
	| CustomControlConfig< Record< string, unknown > >;

export interface ControlRendererProps {
	control: AnyControlConfig;
	isOpen: boolean;
	setIsOpen: ( isOpen: boolean ) => void;
	fitSelectedWidgetToContent?: () => Promise< boolean >;
	updateProps: ( props: Record< string, unknown > ) => void;
	props: Record< string, unknown >;
}
