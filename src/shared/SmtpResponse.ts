import { LINE_SEPARATOR, SEGMENT_SEPARATOR } from "./SmtpConstants";

export class SmtpEnhancedStatusCode {
    public static a_Success: SmtpEnhancedStatusCode = new SmtpEnhancedStatusCode(2, 0, 0);
    public static a_PersistentTransientFailure: SmtpEnhancedStatusCode = new SmtpEnhancedStatusCode(4, 0, 0);
    public static a_PermanentFailure: SmtpEnhancedStatusCode = new SmtpEnhancedStatusCode(5, 0, 0);

    public static b_OtherOrUndefinedStatus: SmtpEnhancedStatusCode = new SmtpEnhancedStatusCode(0, 0, 0);
    public static b_AddressingStatus: SmtpEnhancedStatusCode = new SmtpEnhancedStatusCode(0, 1, 0);
    public static b_MailboxStatus: SmtpEnhancedStatusCode = new SmtpEnhancedStatusCode(0, 2, 0);
    public static b_MailSystemStatus: SmtpEnhancedStatusCode = new SmtpEnhancedStatusCode(0, 3, 0);
    public static b_NetworkAndRoutingStatus: SmtpEnhancedStatusCode = new SmtpEnhancedStatusCode(0, 4, 0);
    public static b_MailDeliveryProtocolStatus: SmtpEnhancedStatusCode = new SmtpEnhancedStatusCode(0, 5, 0);
    public static b_MessageContentOrMediaStatus: SmtpEnhancedStatusCode = new SmtpEnhancedStatusCode(0, 6, 0);
    public static b_SecurityOrPolicyStatus: SmtpEnhancedStatusCode = new SmtpEnhancedStatusCode(0, 7, 0);

    public static REGEX: RegExp = /^([0-9]+.[0-9]+.[0-9]+)$/;

    public constructor(public readonly a: number,
        public readonly b: number,
        public readonly c: number) { }

    /**
     * Adds two status codes.
     * @param other the other.
     * @returns the other added to the current.
     */
    public add(other: SmtpEnhancedStatusCode): SmtpEnhancedStatusCode {
        return new SmtpEnhancedStatusCode(other.a + this.a, other.b + this.b, other.c + this.c);
    }

    /**
     * Encodes the enhanced status code.
     * @returns the encoded version.
     */
    public encode(): string {
        return `${this.a}.${this.b}.${this.c}`;
    }

    /**
     * Decodes the raw string.
     * @param raw the raw string.
     * @returns the parsed status code.
     */
    public static decode(raw: string): SmtpEnhancedStatusCode {
        const segments: string[] = raw.split('.');
        if (segments.length !== 3) {
            throw new Error('Invalid enhanced status code.');
        }

        return new SmtpEnhancedStatusCode(parseInt(segments[0]), parseInt(segments[1]), parseInt(segments[2]));
    }
}

export class SmtpResponse {
    public constructor(public readonly status: number,
        public readonly message: string | string[] | null = null,
        public readonly enhanced_status_code: SmtpEnhancedStatusCode | null = null) { }

    public encode(add_newline: boolean = true): string {
        let arr: string[] = [];

        arr.push(this.status.toString());

        if (this.enhanced_status_code !== null) {
            arr.push(this.enhanced_status_code.encode());
        }

        if (this.message !== null) {
            if (typeof (this.message) === 'string') {
                arr.push(this.message.trim());
            } else {
                for (const message_item of this.message) {
                    arr.push(message_item.trim());
                }
            }
        }

        let result: string = arr.join(SEGMENT_SEPARATOR);

        if (add_newline) {
            result += LINE_SEPARATOR;
        }

        return result;
    }

    /**
     * Gets the message in string format.
     */
    public get message_string(): string {
        if (this.message === null) {
            throw new Error('There is no message.');
        }
        
        if (typeof this.message === 'string') {
            return this.message;
        }

        return this.message.join('');
    }

    /**
     * Gets the segments of the message.
     */
    public get message_segments(): string[] {
        return this.message_string.split(SEGMENT_SEPARATOR);
    }

    /**
     * The generator to decode a response.
     * @returns the decoded response.
     */
    public static *fancy_decode(): Generator<void, SmtpResponse, string> {
        let status: number | null = null;
        let message: string[] = [];

        // Reads all the lines, and parses them, we break when we're done.
        while (true) {
            // Gets the segment.
            let segment: string = yield;
            
            // Parses the segment.
            const segment_status: number = parseInt(segment.substring(0, 3));
            segment = segment.substring(3);
            const segment_separator: string = segment.charAt(0);
            segment = segment.substring(1);
            const segment_message: string = segment;

            // Checks if the code is valid.
            if (!status) {
                status = segment_status;
            } else if (status !== segment_status) {
                throw new Error('Segment status mismatch.');
            }

            // Appends the message.
            message.push(segment_message);

            // Checks if there will be a next segment.
            if (segment_separator === '-') {
                continue;
            } else if (segment_separator === ' ') {
                break;
            } else {
                throw new Error('Invalid segment separator.');
            }
        }

        // Returns the result.
        return new SmtpResponse(status, message);
    }
}
