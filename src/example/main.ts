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
import {SmtpConfig} from "../shared/SmtpConfig";
import { SmtpClientCommander } from "../client/SmtpClientCommander";

let client = new SmtpClient({
    debug: true
});

let commander = new SmtpClientCommander(client, {
    debug: true
});
client.connect('contabo.de', 25, false, true);
