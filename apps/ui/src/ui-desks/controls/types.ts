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

export type ControlConfig< TProps extends Record< string, unknown > = Record< string, string > > =
	ColorControlConfig< TProps >;

export interface ControlRendererProps< TControl extends ControlConfig = ControlConfig > {
	control: TControl;
	isOpen: boolean;
	setIsOpen: ( isOpen: boolean ) => void;
	updateProps: ( props: Record< string, unknown > ) => void;
	props: Record< string, unknown >;
}
