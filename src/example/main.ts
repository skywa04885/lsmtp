// import { XOATH2Token } from "lxoauth2/dist/XOAUTH2Token";
// import { SmtpServer } from "../server/SmtpServer";
// import { SmtpServerConfig, SmtpServerFeatureFlag } from "../server/SmtpServerConfig";
// import { SmtpServerConnection } from "../server/SmtpServerConnection";
// import { SmtpServerMail } from "../server/SmtpServerMail";
// import { MAX_MESSAGE_SIZE } from "../shared/SmtpConstants";
// import { SmtpMailbox } from "../shared/SmtpMailbox";
// import { SmtpUser } from "../shared/SmtpUser";
// import fs from 'fs';
// import path from "path";

import { SmtpClient } from "../client/SmtpClient";
import { SmtpSocket } from "../shared/SmtpSocket";
import {SmtpClientManager} from "../client/SmtpClientManager";

// const private_key: Buffer = fs.readFileSync(path.join(__dirname, '../../', 'private.key'));
// const cert: Buffer = fs.readFileSync(path.join(__dirname, '../../', 'certificate.crt'));

// async function handle_mail (mail: SmtpServerMail, connection: SmtpServerConnection): Promise<Error | null> {
//     console.log(mail);
    
//     return null;
// }

// async function validate_from(mailbox: string, connection: SmtpServerConnection): Promise<boolean> {
//     return true;
// };

// async function validate_to(mailbox: string, connection: SmtpServerConnection): Promise<boolean> {
//     return true;
// };

// async function verify_name(mailbox: string, connection: SmtpServerConnection): Promise<SmtpMailbox[]> {
//     return [ new SmtpMailbox(mailbox) ];
// };

// async function verify_mailbox(mailbox: string, connection: SmtpServerConnection): Promise<SmtpMailbox> {
//     return new SmtpMailbox(mailbox);
// };

// async function get_user(user: string, connection: SmtpServerConnection): Promise<SmtpUser | null> {
//     /// AGFzZEBhc2QuY29tAHRlc3QxMjM=
//     return new SmtpUser('asd@asd.com', 'test123');
// }

// async function password_compare(pass: string, hash: string): Promise<boolean> {
//     return pass === hash;
// }

// async function verify_xoath2_token(token: XOATH2Token, connection: SmtpServerConnection): Promise<SmtpUser | null> {
//     return new SmtpUser('asd@asd.com', 'test123');
// }

// const enabled_features: number = SmtpServerFeatureFlag.Auth
//     | SmtpServerFeatureFlag.Chunking
//     | SmtpServerFeatureFlag.Expn
//     | SmtpServerFeatureFlag.Vrfy
//     | SmtpServerFeatureFlag.XClient
//     | SmtpServerFeatureFlag.XForward;
// const config: SmtpServerConfig = new SmtpServerConfig(validate_from, validate_to, 
//     verify_name, verify_mailbox, handle_mail, get_user, 
//     password_compare, verify_xoath2_token, 'localhost', 
//     enabled_features, MAX_MESSAGE_SIZE, {
//         cert: cert,
//         key: private_key
//     });
// const server: SmtpServer = new SmtpServer(config);
// server.run();

// let client = new SmtpClient('localhost', false, 'gmail-smtp-in.l.google.com', 25,
//     'luke.rieff@asd.com',
//     ['luke.rieff@gmail.com','sem.rieff@gmail.com'],
// `From: Some One <someone@example.com>\r
// MIME-Version: 1.0\r
// Content-Type: multipart/mixed;\r
//         boundary="XXXXboundary text"\r
// \r
// This is a multipart message in MIME format.\r
// \r
// --XXXXboundary text\r
// Content-Type: text/plain\r
// \r
// this is the body text\r
// \r
// --XXXXboundary text\r
// Content-Type: text/plain;\r
// Content-Disposition: attachment;\r
//         filename="test.txt"\r
// \r
// this is the attachment text\r
// \r
// .\r
// .\r
// .\r
// \r
// --XXXXboundary text--\r
// \r
// `);
// client.begin()

const DATA = `From: Some One <someone@example.com>\r
MIME-Version: 1.0\r
Content-Type: multipart/mixed;\r
        boundary="XXXXboundary text"\r
\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
This is a multipart message in MIME format.\r
\r
--XXXXboundary text\r
Content-Type: text/plain\r
\r
this is the body text\r
\r
--XXXXboundary text\r
Content-Type: text/plain;\r
Content-Disposition: attachment;\r
        filename="test.txt"\r
\r
this is the attachment text\r
\r
.\r
.\r
.\r
\r
--XXXXboundary text--\r
\r
`;

const manager = new SmtpClientManager({
    max_assignments_per_client: 3,
    client_keep_alive_interval: 1000,
    debug: true,
    server_domain: 'asd.com'
});

for (let i = 0; i < 9; ++i) {
    manager.assign('localhost', {
        to: ['luke.rieff@gmail.com'],
        from: 'luke.rieff@kaas.com',
        data: DATA,
        callback: () => console.log(`Executed ${i}`)
    });
}