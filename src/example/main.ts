import { XOATH2Token } from "lxoauth2/dist/XOAUTH2Token";
import { SmtpServer } from "../server/SmtpServer";
import { SmtpServerConfig, SmtpServerFeatureFlag } from "../server/SmtpServerConfig";
import { SmtpServerConnection } from "../server/SmtpServerConnection";
import { SmtpServerMail } from "../server/SmtpServerMail";
import { MAX_MESSAGE_SIZE } from "../shared/SmtpConstants";
import { SmtpMailbox } from "../shared/SmtpMailbox";
import { SmtpUser } from "../shared/SmtpUser";
import fs from 'fs';
import path from "path";

const private_key: Buffer = fs.readFileSync(path.join(__dirname, '../../', 'private.key'));
const cert: Buffer = fs.readFileSync(path.join(__dirname, '../../', 'certificate.crt'));

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

async function get_user(user: string, connection: SmtpServerConnection): Promise<SmtpUser | null> {
    /// AGFzZEBhc2QuY29tAHRlc3QxMjM=
    return new SmtpUser('asd@asd.com', 'test123');
}

async function password_compare(pass: string, hash: string): Promise<boolean> {
    return pass === hash;
}

async function verify_xoath2_token(token: XOATH2Token, connection: SmtpServerConnection): Promise<SmtpUser | null> {
    return new SmtpUser('asd@asd.com', 'test123');
}

const enabled_features: number = SmtpServerFeatureFlag.Auth
    | SmtpServerFeatureFlag.BinaryMime
    | SmtpServerFeatureFlag.Chunking
    | SmtpServerFeatureFlag.Expn
    | SmtpServerFeatureFlag.Vrfy
    | SmtpServerFeatureFlag.XClient
    | SmtpServerFeatureFlag.XForward;
const config: SmtpServerConfig = new SmtpServerConfig(validate_from, validate_to, 
    verify_name, verify_mailbox, handle_mail, get_user, 
    password_compare, verify_xoath2_token, 'localhost', 
    enabled_features, MAX_MESSAGE_SIZE, {
        cert: cert,
        key: private_key
    });
const server: SmtpServer = new SmtpServer(config);
server.run();