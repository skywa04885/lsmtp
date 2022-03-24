import { SEGMENT_SEPARATOR } from "./SmtpConstants";

export enum SmtpCapabilityType {
    Help = 'HELP',
    Expn = 'EXPN',
    SmtpEnhancedStatusCodes = 'ENHANCEDSTATUSCODES',
    StartTLS = 'STARTTLS',
    Chunking = 'CHUNKING',
    EightBitMIME = '8BITMIME',
    SmtpUTF8 = 'SMTPUTF8',
    Vrfy = 'VRFY',
    Size = 'SIZE',
    Auth = 'AUTH',
    Pipelining = 'PIPELINING',
    BinaryMIME = 'BINARYMIME',
}

export class SmtpCapability {
    /**
     * Constructs a new pop capability.
     * @param type the type of cabability.
     * @param args the arguments.
     */
    public constructor(public readonly type: SmtpCapabilityType, public readonly args: string | string[] | null = null) { }

    /**
     * Encodes the capability.
     * @returns the encoded capability.
     */
    public encode(): string {
        let arr: string[] = [];

        arr.push(this.type);

        if (this.args !== null) {
            if (typeof (this.args) === 'string') {
                arr.push(this.args.trim());
            } else {
                arr = arr.concat(this.args);
            }
        }

        return arr.join(SEGMENT_SEPARATOR);
    }
}