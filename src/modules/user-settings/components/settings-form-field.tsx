interface SettingsFormFieldProps {
	label: string;
	children: React.ReactNode;
}

export const SettingsFormField = ( { label, children }: SettingsFormFieldProps ) => (
	<div className="flex gap-1.5 flex-col">
		<label className="font-semibold">{ label }</label>
		{ children }
	</div>
);
