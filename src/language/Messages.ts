import { SmtpServerConnection } from "../server/SmtpServerConnection";
import { SmtpCommandType } from "../shared/SmtpCommand";
import { HOSTNAME } from "../shared/SmtpConstants";

export const SUFFIX = `${HOSTNAME} - lsmtp`;

export const Messages = {
    greeting: {
        _: (connection: SmtpServerConnection): string => {
            return `${connection.server.config.domain} ESMTP ${SUFFIX}`
        },
    },
    general: {
        command_invalid: (connection: SmtpServerConnection): string => {
            return `command not recognized. ${SUFFIX}`;
        },
        command_not_implemented: (command_type: SmtpCommandType, connection: SmtpServerConnection): string => {
            return `command ${command_type} is not implemented. ${SUFFIX}`;
        },
        syntax_error: (connection: SmtpServerConnection): string => {
            return `Syntax error. ${SUFFIX}`;
        },
        bad_sequence_of_commands: (connection: SmtpServerConnection): string => {
            return `Bad sequence of commands. ${SUFFIX}`;
        },
    },
    quit: {
        _: (connection: SmtpServerConnection): string => {
            return `OK, closing transmission channel. ${SUFFIX}`;
        },
    },
    noop: {
        _: (connection: SmtpServerConnection): string => {
            return `OK. ${SUFFIX}`;
        },
    },
    help: {
        _: (connection: SmtpServerConnection): string => {
            return `https://github.com/skywa04885/lsmtp, maintainer: luke.rieff@gmail.com ${SUFFIX}`;
        },
    },
    helo: {
        _: (connection: SmtpServerConnection): string => {
            return `${connection.server.config.domain} at your service.`;
        },
        may_not_be_empty: (connection: SmtpServerConnection): string => {
            return `Empty ${SmtpCommandType.Helo} argument not allowed, closing connection. ${SUFFIX}`;
        },
        invalid_argument: (argument: string, connection: SmtpServerConnection): string => {
            return `${SmtpCommandType.Helo} argument "${argument}" invalid, closing connection. ${SUFFIX}`;
        },
    },
    mail: {
        _: (connection: SmtpServerConnection): string => {
            return `OK ${connection.session.from} ${SUFFIX}`;
        },
        nested: (connection: SmtpServerConnection): string => {
            return `Rejected, nested ${SmtpCommandType.Mail} command. ${SUFFIX}`;
        },
        may_not_be_empty: (connection: SmtpServerConnection): string => {
            return `Empty ${SmtpCommandType.Mail} argument not allowed, closing connection. ${SUFFIX}`;
        },
        rejected: (email: string, connection: SmtpServerConnection): string => {
            return `Rejected. ${SUFFIX}`;
        },
    },
    rcpt: {
        _: (connection: SmtpServerConnection): string => {
            if (!connection.session.to) {
                throw new Error('No to array set.');
            }

            return `OK ${connection.session.to[connection.session.to.length - 1]} ${SUFFIX}`;
        },
        may_not_be_empty: (connection: SmtpServerConnection): string => {
            return `Empty ${SmtpCommandType.Rcpt} argument not allowed, closing connection. ${SUFFIX}`;
        },
        rejected: (email: string, connection: SmtpServerConnection): string => {
            return `Rejected. ${SUFFIX}`;
        },
        already_recipient: (email: string, connection: SmtpServerConnection): string => {
            return `Rejected, ${email} is already an recipient. ${SUFFIX}`;
        },
    },
    ehlo: {
        _: (connection: SmtpServerConnection): string => {
            return `${connection.server.config.domain} at your service, [${connection.smtp_socket.address}]`;
        },
        may_not_be_empty: (connection: SmtpServerConnection): string => {
            return `Empty ${SmtpCommandType.Ehlo} argument not allowed, closing connection. ${SUFFIX}`;
        },
        invalid_argument: (argument: string, connection: SmtpServerConnection): string => {
            return `${SmtpCommandType.Ehlo} argument "${argument}" invalid, closing connection. ${SUFFIX}`;
        },
    }
};
