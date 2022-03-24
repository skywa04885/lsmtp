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
}
