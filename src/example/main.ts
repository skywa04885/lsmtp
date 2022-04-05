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
import {SmtpClientManager, SmtpClientManagerAssignment} from "../client/SmtpClientManager";
import { SmtpConfig } from "../shared/SmtpConfig";
import { SmtpClientCommander } from "../client/SmtpClientCommander";
import { SmtpClientAssignment } from "../client/SmtpCommanderAssignment";
import {
  mime_compose,
  MimeComposition,
  MimeContentType,
  MimeDateValue,
  MimeEmailValue,
} from "llibmime";

let comp = new MimeComposition("fannst.nl");
comp.subject = "Hello World";
comp.to = new MimeEmailValue([
  { name: null, address: "luke.rieff@gmail.com" },
]);
comp.from = new MimeEmailValue([
  { name: null, address: "doesnotexist@fannst.nl" },
]);
comp.date = new MimeDateValue();
comp.add_text_section(
  MimeContentType.TextPlain,
  "Hello luke! THis is a test message from the SMTP server."
);
comp.add_text_section(
  MimeContentType.TextHTML,
  "<h1>Hello luke! THis is a test message from the SMTP server.</h1>"
);

let a = mime_compose(comp, false);

(async function () {
  let buffers: Buffer[] = [];
  for await (let chunk of a) {
    if (typeof chunk === 'string') {
      chunk = Buffer.from(chunk);
    }
    buffers.push(chunk);
  }

  const buffer: Buffer = Buffer.concat(buffers);

  const smtp_client_manager: SmtpClientManager = new SmtpClientManager({
    pool_options: {
      client_options: {
        debug: true,
      },
      commander_options: {
        max_assignments: 2,
        debug: true,
      },
      debug: true,
    },
    debug: true,
  });

  const smtp_client_manager_assignment: SmtpClientManagerAssignment = new SmtpClientManagerAssignment(
    [ 'luke.rieff@yahoo.com' ],
    'nonexisting@fannst.nl', buffer, result => {
      result.forEach(a => console.log(a))
    });

  await smtp_client_manager.assign(smtp_client_manager_assignment);
  await smtp_client_manager.assign(smtp_client_manager_assignment);
  await smtp_client_manager.assign(smtp_client_manager_assignment);
  await smtp_client_manager.assign(smtp_client_manager_assignment);
})();

// let client = new SmtpClient({
//   debug: true,
// });
//
// let commander = new SmtpClientCommander(client, {
//   debug: true,
// });
// client.connect("gmail.com", 25, false, true);
//
// commander.on("ready", () => {
//   commander.assign({
//     from: "doesnotexist@fannst.nl",
//     to: ["luke.rieff@gmail.com"],
//     data: mime_compose(comp, false),
//     callback: () => console.log("done"),
//   });
//
// });
