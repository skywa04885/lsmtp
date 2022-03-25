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
    Send = 'SEND',
    Soml = 'SOML',
    Saml = 'SAML',
    Turn = 'TURN',
    Verb = 'VERB',
    Onex = 'ONEX',
    CheckPoint = 'CHECKPOINT',
    DeliverBy = 'DELIVER_BY',
    Dsn = 'DSN',
    Atrn = 'ATRN',
    UTF8Smtp = 'UTF8SMTP',
    RequireTLS = 'REQUIRETLS',
}

export class SmtpCapability {
    /**
     * Constructs a new pop capability.
     * @param type the type of cabability.
     * @param args the arguments.
     */
    public constructor(public readonly type: SmtpCapabilityType | string, public readonly args: string | string[] | null = null) { }

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

    /**
     * Decodes the given smtp capability.
     * @param raw the capability to decode.
     */
    public static decode(raw: string): SmtpCapability {
        // trims the crap off.
        raw = raw.trim();

        // Splits the capability at the segment separator.
        const segments: string[] = raw.split(SEGMENT_SEPARATOR);

        // Makes sure there is at least one segment.
        if (segments.length < 1) {
            throw new Error('Not enough segments.');
        }

        // Returns the result.
        return new SmtpCapability(segments[0].trim().toUpperCase(), segments.slice(1));
    }

    /**
     * Decodes many SMTP capabilities.
     * @param lines the lines.
     * @param from start reading from line.
     * @param to read to line.
     */
    public static decode_many(lines: string[], from: number | null = null, to: number | null = null): SmtpCapability[] {
        if (!from) {
            // If no from specified set it to the start.
            from = 0;
        } else if (from > lines.length) {
            throw new Error('From is larger than the number of lines.');
        }

        if (!to) {
            // If no to specified, set it to the number of lines.
            to = lines.length;
        } else if (to > lines.length) {
            throw new Error('To is larger than the number of lines.');
        }

        let result: SmtpCapability[] = [];
        for (let i = from; i < to; ++i) {
            result.push(SmtpCapability.decode(lines[i]))
        }

        return result;
    }
}