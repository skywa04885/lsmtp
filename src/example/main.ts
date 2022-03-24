import { SmtpServer } from "../server/SmtpServer";
import { SmtpServerConfig, SmtpServerFeatureFlag } from "../server/SmtpServerConfig";
import { SmtpServerConnection } from "../server/SmtpServerConnection";
import { SmtpServerMail } from "../server/SmtpServerMail";
import { MAX_MESSAGE_SIZE } from "../shared/SmtpConstants";
import { SmtpMailbox } from "../shared/SmtpMailbox";

async function handle_mail (mail: SmtpServerMail, connection: SmtpServerConnection): Promise<Error | null> {
    console.log(mail);
    
    return null;
}

async function validate_from(mailbox: string, connection: SmtpServerConnection): Promise<boolean> {
    return true;
};

async function validate_to(mailbox: string, connection: SmtpServerConnection): Promise<boolean> {
    return true;
};

async function verify_name(mailbox: string, connection: SmtpServerConnection): Promise<SmtpMailbox[]> {
    return [ new SmtpMailbox(mailbox) ];
};

async function verify_mailbox(mailbox: string, connection: SmtpServerConnection): Promise<SmtpMailbox> {
    return new SmtpMailbox(mailbox);
};

const enabled_features: number = SmtpServerFeatureFlag.Auth
    | SmtpServerFeatureFlag.BinaryMime
    | SmtpServerFeatureFlag.Chunking
    | SmtpServerFeatureFlag.Expn
    | SmtpServerFeatureFlag.Vrfy
    | SmtpServerFeatureFlag.XClient
    | SmtpServerFeatureFlag.XForward;
const config: SmtpServerConfig = new SmtpServerConfig(validate_from, validate_to, verify_name, verify_mailbox, handle_mail, 'localhost', enabled_features, MAX_MESSAGE_SIZE, {});
const server: SmtpServer = new SmtpServer(config);
server.run();