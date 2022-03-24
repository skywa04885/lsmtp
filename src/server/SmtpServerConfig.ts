import { TLSSocketOptions } from "tls";
import { SmtpMailbox } from "../shared/SmtpMailbox";
import { SmtpUser } from "../shared/SmtpUser";
import { SmtpServerConnection } from "./SmtpServerConnection";
import { SmtpServerMail } from "./SmtpServerMail";
import { XOATH2Token } from 'lxoauth2/dist/XOAUTH2Token';

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
        public readonly validate_from: (mailbox: string, connection: SmtpServerConnection) => Promise<boolean>,
        public readonly validate_to: (mailbox: string, connection: SmtpServerConnection) => Promise<boolean>,
        public readonly verify_name: (name: string, connection: SmtpServerConnection) => Promise<SmtpMailbox[]>,
        public readonly verify_mailbox: (mailbox: string, connection: SmtpServerConnection) => Promise<SmtpMailbox | null>,
        public readonly handle_mail: (mail: SmtpServerMail, connection: SmtpServerConnection) => Promise<Error | null>,
        public readonly get_user: (user: string, connection: SmtpServerConnection) => Promise<SmtpUser | null>,
        public readonly password_compare: (pass: string, hash: string) => Promise<boolean>,
        public readonly verify_xoath2: (token: XOATH2Token, connection: SmtpServerConnection) => Promise<SmtpUser | null>,
        public readonly domain: string,
        public readonly enabled_features: number,
        public readonly size_limit: number | null,
        public readonly tls_config: TLSSocketOptions
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