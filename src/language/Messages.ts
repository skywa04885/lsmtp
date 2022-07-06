import { SmtpServerConnection } from "../server/SmtpServerConnection";
import { SmtpCommandType } from "../shared/SmtpCommand";
import { HOSTNAME, MAX_MESSAGE_SIZE } from "../shared/SmtpConstants";
import { SmtpMailbox } from "../shared/SmtpMailbox";
import {EmailAddress} from "llibemailaddress";

export const SUFFIX = `${HOSTNAME} - lsmtp`;

export const Messages = {
  greeting: {
    _: (connection: SmtpServerConnection): string => {
      return `${connection.server.config.domain} ESMTP ${SUFFIX}`;
    },
  },
  auth: {
    _: (connection: SmtpServerConnection): string => {
      return `Authentication successful. ${SUFFIX}`;
    },
    bad_credentials: (connection: SmtpServerConnection): string => {
      return `Bad credentials. ${SUFFIX}`;
    },
  },
  data: {
    done: (connection: SmtpServerConnection): string => {
      return `OK, received ${connection.session.data?.length} bytes. ${SUFFIX}`;
    },
    _: (connection: SmtpServerConnection): string => {
      return `OK, go ahead. ${SUFFIX}`;
    },
    too_large: (connection: SmtpServerConnection): string => {
      return `Message size exceeded limit of ${connection.server.config.size_limit} bytes, terminating connection. ${SUFFIX}`;
    },
  },
  bdat: {
    _: (size: number, connection: SmtpServerConnection): string => {
      return `OK, received ${size} bytes. ${SUFFIX}`;
    },
    done: (connection: SmtpServerConnection): string => {
      return `OK, received ${connection.session.data?.length} bytes. ${SUFFIX}`;
    },
  },
  general: {
    command_invalid: (connection: SmtpServerConnection): string => {
      return `command not recognized. ${SUFFIX}`;
    },
    command_not_implemented: (
      command_type: SmtpCommandType,
      connection: SmtpServerConnection
    ): string => {
      return `command ${command_type} is not implemented. ${SUFFIX}`;
    },
    syntax_error: (connection: SmtpServerConnection): string => {
      return `Syntax error. ${SUFFIX}`;
    },
    policy_error: (connection: SmtpServerConnection): string => {
      return `Policy error. ${SUFFIX}`;
    },
    bad_sequence_of_commands: (connection: SmtpServerConnection): string => {
      return `Bad sequence of commands. ${SUFFIX}`;
    },
    invalid_arguments: (connection: SmtpServerConnection): string => {
      return `Invalid arguments. ${SUFFIX}`;
    },
    command_disabled: (
      command_type: SmtpCommandType,
      connection: SmtpServerConnection
    ): string => {
      return `Command ${command_type} is disabled. ${SUFFIX}`;
    },
    rejected: (explaination: string, connection: SmtpServerConnection): string => {
      return `Rejecting message, explaination: '${explaination}'`;
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
  rset: {
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
    invalid_argument: (
      argument: string,
      connection: SmtpServerConnection
    ): string => {
      return `${SmtpCommandType.Helo} argument "${argument}" invalid, closing connection. ${SUFFIX}`;
    },
  },
  mail: {
    _: (connection: SmtpServerConnection): string => {
      return `OK ${connection.session.from!.email.address} ${SUFFIX}`;
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
  vrfy: {
    _: (mailbox: SmtpMailbox, connection: SmtpServerConnection): string => {
      return `${mailbox.encode()} ${SUFFIX}`;
    },
    may_not_be_empty: (connection: SmtpServerConnection): string => {
      return `Empty ${SmtpCommandType.Vrfy} argument not allowed, closing connection. ${SUFFIX}`;
    },
    ambiguous: (
      address_or_name: string,
      connection: SmtpServerConnection
    ): string => {
      return `${address_or_name} is ambiguous. ${SUFFIX}`;
    },
    mailbox_unavailable: (connection: SmtpServerConnection): string => {
      return `Mailbox unavailable, ${SUFFIX}`;
    },
  },
  rcpt: {
    _: (connection: SmtpServerConnection): string => {
      if (!connection.session.to) {
        throw new Error("No to array set.");
      }

      return `OK ${
        connection.session.to[connection.session.to.length - 1].email.address
      } ${SUFFIX}`;
    },
    may_not_be_empty: (connection: SmtpServerConnection): string => {
      return `Empty ${SmtpCommandType.Rcpt} argument not allowed, closing connection. ${SUFFIX}`;
    },
    rejected: (email: string, connection: SmtpServerConnection): string => {
      return `Rejected. ${SUFFIX}`;
    },
    already_recipient: (
      email: EmailAddress,
      connection: SmtpServerConnection
    ): string => {
      return `Rejected, ${email.address} is already an recipient. ${SUFFIX}`;
    },
  },
  ehlo: {
    _: (connection: SmtpServerConnection): string => {
      return `${connection.server.config.domain} at your service, [${connection.smtp_socket.address}]`;
    },
    may_not_be_empty: (connection: SmtpServerConnection): string => {
      return `Empty ${SmtpCommandType.Ehlo} argument not allowed, closing connection. ${SUFFIX}`;
    },
    invalid_argument: (
      argument: string,
      connection: SmtpServerConnection
    ): string => {
      return `${SmtpCommandType.Ehlo} argument "${argument}" invalid, closing connection. ${SUFFIX}`;
    },
  },
};
