export class ValidationError extends Error {
	optionName: string;
	givenValue: string;
	validationMessage: string;

	constructor( optionName: string, givenValue: string, validationMessage: string ) {
		super();
		this.name = 'ValidationError';
		this.optionName = optionName;
		this.givenValue = givenValue;
		this.validationMessage = validationMessage;
	}

	get message(): string {
		return `Invalid values: \n - Argument: ${ this.optionName }, Given: "${ this.givenValue }", ${ this.validationMessage }.`;
	}
}