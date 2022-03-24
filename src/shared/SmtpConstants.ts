import os from 'os';

export const SEGMENT_SEPARATOR: string = ' ';
export const LINE_SEPARATOR: string = '\r\n';
export const DATA_END = '\r\n.\r\n';
export const HOSTNAME: string = os.hostname();
export const MAX_INVALID_COMMANDS: number = 10;
export const MAX_MESSAGE_SIZE: number = 1024 * 1024 * 10; // 10Mb
