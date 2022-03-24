import { SmtpServer } from "../server/SmtpServer";

const server: SmtpServer = new SmtpServer({
    domain: 'localhost',
    validate_from: (email, _) => {
        return true;
    },
    validate_to: (email, _) => {
        return true;
    },
});
server.run();