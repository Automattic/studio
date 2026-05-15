import type { Icon } from '@wordpress/ui';
import type { ComponentProps, ReactElement } from 'react';

export interface ColorControlOption< TValue extends string = string > {
	value: TValue;
	label: string;
	color: string;
}

export interface SelectControlOption< TValue extends string = string > {
	value: TValue;
	label: string;
}

type StringControlPropKey< TProps extends Record< string, unknown > > = {
	[ TKey in Extract< keyof TProps, string > ]: NonNullable< TProps[ TKey ] > extends string
		? TKey
		: never;
}[ Extract< keyof TProps, string > ];

type ControlIcon = ComponentProps< typeof Icon >[ 'icon' ];

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

export type SelectControlConfig<
	TProps extends Record< string, unknown > = Record< string, string >,
> = {
	[ TProperty in StringControlPropKey< TProps > ]: {
		type: 'select';
		id: string;
		property: TProperty;
		label: string;
		icon: ControlIcon;
		defaultValue: Extract< NonNullable< TProps[ TProperty ] >, string >;
		options: Array< SelectControlOption< Extract< NonNullable< TProps[ TProperty ] >, string > > >;
	};
}[ StringControlPropKey< TProps > ];

export interface ControlRenderContext<
	TProps extends Record< string, unknown > = Record< string, unknown >,
> {
	isOpen: boolean;
	setIsOpen: ( isOpen: boolean ) => void;
	updateProps: ( props: Record< string, unknown > ) => void;
	runWidgetAction: ( actionId: string ) => boolean;
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
	| SelectControlConfig< TProps >
	| CustomControlConfig< TProps >;

export interface AnyColorControlConfig {
	type: 'color';
	id: string;
	property: string;
	label: string;
	options: Array< ColorControlOption< string > >;
}

export interface AnySelectControlConfig {
	type: 'select';
	id: string;
	property: string;
	label: string;
	icon: ControlIcon;
	defaultValue: string;
	options: Array< SelectControlOption< string > >;
}

export type AnyControlConfig =
	| AnyColorControlConfig
	| AnySelectControlConfig
	| CustomControlConfig< Record< string, unknown > >;

export interface ControlRendererProps {
	control: AnyControlConfig;
	isOpen: boolean;
	setIsOpen: ( isOpen: boolean ) => void;
	updateProps: ( props: Record< string, unknown > ) => void;
	runWidgetAction: ( actionId: string ) => boolean;
	props: Record< string, unknown >;
}
