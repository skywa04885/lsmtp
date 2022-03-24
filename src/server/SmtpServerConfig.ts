import { SmtpMailbox } from "../shared/SmtpMailbox";
import { SmtpServerConnection } from "./SmtpServerConnection";

export enum SmtpServerFeatureFlag {
    Chunking = (1 << 0),            // Chunking and BinaryMIME.
    Vrfy = (1 << 1),                // VRFY command.
    Expn = (1 << 2),                // EXPN command.
    XClient = (1 << 3),             // XClient command.
    XForward = (1 << 4),            // XForward command.
    Auth = (1 << 5),                // Authentication.
    BinaryMime = (1 << 6),          // BinaryMIME.
    EightBitMime = (1 << 7),        // 8BITMIME.
}

export class SmtpServerConfig {
    public constructor(
        public readonly domain: string,
        public readonly validate_from: (mailbox: string, connection: SmtpServerConnection) => Promise<boolean>,
        public readonly validate_to: (mailbox: string, connection: SmtpServerConnection) => Promise<boolean>,
        public readonly verbose: boolean,
        public readonly verify_name: (name: string, connection: SmtpServerConnection) => Promise<SmtpMailbox[]>,
        public readonly verify_mailbox: (mailbox: string, connection: SmtpServerConnection) => Promise<SmtpMailbox | null>,
        public readonly enabled_features: number,
        public readonly size_limit: number | null
    ) { }

    /**
     * Checks if the given feature is enabled.
     * @param feature the feature to check.
     * @returns if the feature is enabled.
     */
    public feature_enabled(feature: SmtpServerFeatureFlag): boolean {
        return (this.enabled_features & feature) !== 0;
    }
};