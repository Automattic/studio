import { JetpackValidator } from './JetpackValidator';
import { Validator } from './Validator';

export * from './Validator';
export * from './JetpackValidator';

export const allValidators: Validator[] = [ new JetpackValidator() ];
