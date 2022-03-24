import { SmtpServer } from "../server/SmtpServer";
import { SmtpMailbox } from "../shared/SmtpMailbox";

const server: SmtpServer = new SmtpServer({
    domain: 'localhost',
    validate_from: async (mailbox, _) => {
        return true;
    },
    validate_to: async (mailbox, _) => {
        return true;
    },
    verify_name: async (mailbox, _) => {
        return [new SmtpMailbox(mailbox)];
    },
    verify_mailbox: async (mailbox, _) => {
        return new SmtpMailbox(mailbox);
    },
    verbose: true,
});
server.run();