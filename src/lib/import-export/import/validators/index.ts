import { JetpackValidator } from './jetpack-validator';
import { Validator } from './Validator';

export * from './Validator';
export * from './jetpack-validator';

export const allValidators: Validator[] = [ new JetpackValidator() ];
