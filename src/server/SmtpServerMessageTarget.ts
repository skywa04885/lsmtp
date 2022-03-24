import { PolicyError } from "../shared/SmtpException";
import { SMTP_EMAIL_REGEX } from "../shared/SmtpRegexes";

export enum SmtpServerMessageTargetType {
    Mailbox = 'MAILBOX',
    Relay = 'RELAY',
}

export class SmtpServerMessageTarget {
    public static readonly ADDRESS_SEPARATOR: string = ',';

    /**
     * COnstructs a new SmtpServerMessageTarget.
     * @param type the type of target.
     * @param address the address of target.
     * @param host the possible relay host.
     */
    public constructor(public type: SmtpServerMessageTargetType,
        public readonly address: string,
        public readonly host: string | null = null) { }
    
    public static decode(raw: string): SmtpServerMessageTarget[] {
        let relay_to: string | null = null;

        // Trims just to be sure.
        raw = raw.trim();

        // Loops over all the segments.
        const raw_segments: string[] = raw.split(this.ADDRESS_SEPARATOR);
        return raw_segments.map((segment: string, index: number): SmtpServerMessageTarget => {
            // Trims just to be sure.
            segment = segment.trim();

            // Gets the split index, if not there throw error.
            const split_index: number = segment.indexOf('@');
            if (split_index === -1) {
                throw new Error(`Invalid message target '${segment}'`);
            }

            // If the split index === 0 we're dealing with a relay target.
            if (split_index === 0) {
                throw new PolicyError('Relay targets are not supported.');
                return;
            }
            
            // We're not dealing with a relay target, check if it is an valid address.
            if (!segment.match(SMTP_EMAIL_REGEX)) {
                throw new Error(`Invalid mailbox target: '${segment}'`);
            }

            // Returns the target.
            return new SmtpServerMessageTarget(SmtpServerMessageTargetType.Mailbox, segment);
        });
    }
}