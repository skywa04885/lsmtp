import {HOSTNAME} from "./SmtpConstants";

export interface SmtpConfig {
    domain: string,
    client: {
        noop_interval?: number,             // The number of ms between NOOP commands.
        timeout?: number,                   // The number of ms to keep a client alive.
        debug?: boolean,                    // If the client is in debug mode.
        plain_port?: number,                // The plain SMTP port number.
        tls_port?: number,                  // The TLS SMTP port number.
        max_assignments?: number,           // The max number of assignments per command.
    },
    manager: {
        debug?: boolean,
    },
    pool: {
        debug?: boolean,
    }
}
