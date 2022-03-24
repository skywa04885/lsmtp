import os from 'os';
import { SmtpAuthType } from './SmtpAuth';
import { SmtpCapability, SmtpCapabilityType } from './SmtpCapability';

export const SEGMENT_SEPARATOR: string = ' ';
export const LINE_SEPARATOR: string = '\r\n';
export const DATA_END = '\r\n.\r\n';
export const HOSTNAME: string = os.hostname();
export const MAX_INVALID_COMMANDS: number = 10;
export const MAX_MESSAGE_SIZE: number = 1024 * 1024 * 10; // 10Mb
export const CAPABILITIES: SmtpCapability[] = [
    new SmtpCapability(SmtpCapabilityType.Auth, [ SmtpAuthType.PLAIN.toString() ]),
    new SmtpCapability(SmtpCapabilityType.EightBitMIME),
    new SmtpCapability(SmtpCapabilityType.Chunking),
    new SmtpCapability(SmtpCapabilityType.Expn),
    new SmtpCapability(SmtpCapabilityType.Help),
    new SmtpCapability(SmtpCapabilityType.Size, [ MAX_MESSAGE_SIZE.toString() ]),
    new SmtpCapability(SmtpCapabilityType.SmtpEnhancedStatusCodes),
    new SmtpCapability(SmtpCapabilityType.SmtpUTF8),
    new SmtpCapability(SmtpCapabilityType.Vrfy),
    new SmtpCapability(SmtpCapabilityType.Pipelining),
];
