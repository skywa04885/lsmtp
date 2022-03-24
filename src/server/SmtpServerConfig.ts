import { SmtpServerConnection } from "./SmtpServerConnection";

export interface SmtpServerConfig {
    domain: string,
    validate_from: (email: string, connection: SmtpServerConnection) => boolean,
    validate_to: (email: string, connection: SmtpServerConnection) => boolean
};