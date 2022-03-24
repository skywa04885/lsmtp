import { SmtpMailbox } from "../shared/SmtpMailbox";
import { SmtpServerConnection } from "./SmtpServerConnection";

export interface SmtpServerConfig {
    domain: string,
    validate_from: (mailbox: string, connection: SmtpServerConnection) => Promise<boolean>,
    validate_to: (mailbox: string, connection: SmtpServerConnection) => Promise<boolean>,
    verbose: boolean,
    verify_name: (name: string, connection: SmtpServerConnection) => Promise<SmtpMailbox[]>,
    verify_mailbox: (mailbox: string, connection: SmtpServerConnection) => Promise<SmtpMailbox | null>,
};