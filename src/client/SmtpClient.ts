import { HasFlags } from "../helpers/HasFlags";
import { Queue } from "../helpers/Queue";
import { SmtpCommand, SmtpCommandType } from "../shared/SmtpCommand";
import { LINE_SEPARATOR } from "../shared/SmtpConstants";
import { SmtpResponse } from "../shared/SmtpResponse";
import { SmtpSocket } from "../shared/SmtpSocket";
import { SmtpClientAssignment } from "./SmtpClientAssignment";
import { SmtpClientDNS } from "./SmtpClientDNS";
import { SmtpClientStream } from "./SmtpClientStream";

export enum SmtpClientState {
    Busy = 'BUSY',
    Idle = 'IDLE',
}

export enum SmtpClientFlag {
    ESMTP = 'ESMTP',
    SMTP = 'SMTP',
}

export class SmtpClient {
    protected _state: SmtpClientState = SmtpClientState.Idle;
    protected _smtp_socket: SmtpSocket | null = null;
    protected _stream: SmtpClientStream | null = null;
    protected _main_instance: AsyncGenerator<void, void, SmtpResponse> | null = null;
    protected _assignments: Queue<SmtpClientAssignment> = new Queue<SmtpClientAssignment>();
    
    public constructor(public readonly server_domain: string,
        public readonly hostname: string,
        public readonly keep_alive_for: number = 60 * 1000) {
        }

    public async init(): Promise<void> {
        // Resolves the MX records.
        const mx: string[] = await SmtpClientDNS.mx(this.hostname);
        if (mx.length === 0) {
            throw new Error('Could not initialize SMTP client, no MX records found.');
        }

        // Selects an exchange.
        const exchange: string = mx[0];

        // Creates the client stream.
        this._stream = new SmtpClientStream({}, (response: SmtpResponse) => this.on_response(response));

        // Creates the smtp socket.
        this._smtp_socket = SmtpSocket.connect(false, exchange, 25);
        this._smtp_socket.socket.pipe(this._stream);
    }

    public async enter_transmission_mode(): Promise<void> {
        // Sets the state.
        this._state = SmtpClientState.Busy;

        // Creates the main instance.
        this._main_instance = this.esmtp_main();
        this._main_instance.next();
    }

    public async enter_idle_mode(): Promise<void> {
        // Sets the state.
        this._state = SmtpClientState.Idle;
    }

    public async on_response(response: SmtpResponse): Promise<void> {
        await this._main_instance?.next(response);
    }

    /**
     * Writes the data in the SmtpClient instance, in the string method.
     */
    protected write_data() {
        const assignment: SmtpClientAssignment = this._assignments.peek();
        
        if (typeof assignment.data !== 'string') {
            throw new Error('Data must be of type string!');
        }

        let line_start: number = 0;
        let line_end: number = assignment.data.indexOf(LINE_SEPARATOR, line_start + LINE_SEPARATOR.length);

        while (line_end !== -1) {
            let line: string = assignment.data.substring(line_start, line_end);
            if (line === '.') {
                line += '.';
            }

            this._smtp_socket?.write(`${line}${LINE_SEPARATOR}`);
            
            line_start = line_end + LINE_SEPARATOR.length;
            line_end = assignment.data.indexOf(LINE_SEPARATOR, line_start);
        }

        this._smtp_socket?.write(`.${LINE_SEPARATOR}`);
    }

    public async *initial_main(): AsyncGenerator<void, void, SmtpResponse> {        
        let response: SmtpResponse;

        // Waits for the initial greet.
        response = yield;
        console.log(response);
    }

    public async *esmtp_main(): AsyncGenerator<void, void, SmtpResponse> {
        const assignment: SmtpClientAssignment = this._assignments.peek();
        let response: SmtpResponse;

        // Writes the EHLO command.
        this._smtp_socket?.write(new SmtpCommand(SmtpCommandType.Ehlo, [ this.server_domain ]).encode(true));
        response = yield;
        console.log(response);

        // Writes the MAIL command.
        this._smtp_socket?.write(new SmtpCommand(SmtpCommandType.Mail, [ `FROM:<${assignment.from}>` ]).encode(true));
        response = yield;
        console.log(response);

        // Writes the RCPT command.
        for (const mailbox of assignment.to) {
            this._smtp_socket?.write(new SmtpCommand(SmtpCommandType.Rcpt, [ `TO:<${mailbox}>` ]).encode(true));
            response = yield;
            console.log(response);
        }

        // Writes the DATA command.
        this._smtp_socket?.write(new SmtpCommand(SmtpCommandType.Data, null).encode(true));
        response = yield;
        console.log(response);

        // Writes the DATA.
        this.write_data();
        response = yield;
        console.log(response);

        // The assignment is finished, dequeue it and perform the final actions.
        assignment.executed(null);
        this._assignments.dequeue();
    }
}