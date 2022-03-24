import net from 'net';
import { EventEmitter } from 'stream';
import tls from 'tls';
import { SmtpAuthType } from '../shared/SmtpAuth';
import { SmtpCapability, SmtpCapabilityType } from '../shared/SmtpCapability';
import { SmtpSocket } from '../shared/SmtpSocket';
import { SmtpServerConfig, SmtpServerFeatureFlag } from './SmtpServerConfig';
import { SmtpServerConnection } from './SmtpServerConnection';
import { SmtpServerSession } from './SmtpServerSession';

export class SmtpServer extends EventEmitter {
    protected plain_server: net.Server | null;
    protected secure_server: tls.Server | null;
    public capabilities: SmtpCapability[] = [];

    /**
     * Constructs a new SmtpServer.
     * @parma config the configuration.
     * @param hostname the hostname to listen on.
     * @param plain_port the plain port to listen on.
     * @param secure_port the secure port to listen on.
     * @param backlog the backlog.
     * @param timeout the timeout of sockets in ms.
     */
    public constructor(public readonly config: SmtpServerConfig, public readonly hostname: string = '0.0.0.0', public readonly plain_port: number = 25,
        public readonly secure_port: number = 465, public readonly backlog: number = 500, public readonly timeout: number = 5 * 1000 * 60) {
        super();

        this.plain_server = null;
        this.secure_server = null;

        // Generates the standard capabilities.
        this.capabilities = [
            new SmtpCapability(SmtpCapabilityType.SmtpEnhancedStatusCodes),
            new SmtpCapability(SmtpCapabilityType.SmtpUTF8),
            new SmtpCapability(SmtpCapabilityType.Pipelining)
        ];

        // Generates the capabilities based on the config.
        if (this.config.size_limit) {
            this.capabilities.push(new SmtpCapability(SmtpCapabilityType.Size, this.config.size_limit.toString()));
        }
        if (this.config.feature_enabled(SmtpServerFeatureFlag.Chunking)) {
            this.capabilities.push(new SmtpCapability(SmtpCapabilityType.Chunking));
        }
        if (this.config.feature_enabled(SmtpServerFeatureFlag.BinaryMime)) {
            this.capabilities.push(new SmtpCapability(SmtpCapabilityType.BinaryMIME));
        }
        if (this.config.feature_enabled(SmtpServerFeatureFlag.Expn)) {
            this.capabilities.push(new SmtpCapability(SmtpCapabilityType.Expn));
        }
        if (this.config.feature_enabled(SmtpServerFeatureFlag.Vrfy)) {
            this.capabilities.push(new SmtpCapability(SmtpCapabilityType.Vrfy));
        }
        if (this.config.feature_enabled(SmtpServerFeatureFlag.EightBitMime)) {
            this.capabilities.push(new SmtpCapability(SmtpCapabilityType.EightBitMIME));
        }
        if (this.config.feature_enabled(SmtpServerFeatureFlag.Auth)) {
            this.capabilities.push(new SmtpCapability(SmtpCapabilityType.Auth, [ SmtpAuthType.PLAIN, SmtpAuthType.XOAUTH2 ]));
        }
    }

    /**
     * Runs the PopServer.
     * @returns ourselves.
     */
    public run(): SmtpServer {
        // Plain
        
        this.plain_server = net.createServer();

        this.plain_server.on('connection', (socket: net.Socket) => this._event_connection(false, socket));
        this.plain_server.on('error', (err: Error) => this._event_error(false, err))

        this.plain_server.listen(this.plain_port, this.hostname, this.backlog, () => this._event_listening(false));

        // Secure

        this.secure_server = tls.createServer(this.config.tls_config);

        this.secure_server.on('secureConnection', (socket: tls.TLSSocket) => this._event_connection(true, socket));
        this.secure_server.on('tlsClientError', (err: Error, _: tls.TLSSocket) => this._event_error(true, err));

        this.secure_server.listen(this.secure_port, this.hostname, this.backlog, () => this._event_listening(true));

        return this;
    }

    /**
     * Close sthe PopServer.
     * @returns ourselves.
     */
    public close(): SmtpServer {
        this.plain_server?.close((err: Error | undefined) => this._event_close(false, err));
        this.secure_server?.close((err: Error | undefined) => this._event_close(true, err));
        
        return this;
    }

    /**
     * Gets called when an close event has been emitted.
     * @param secure if this is the secure server.
     * @param err the possible error.
     */
    protected _event_close(secure: boolean, err: Error | undefined): void {
        this.emit('server_close', secure, err);
    }

    /**
     * Gets called when a listening event is emitted.
     * @param secure if this is the secure server.
     */
    protected _event_listening(secure: boolean): void {
        this.emit('server_listening', secure);
    }

    /**
     * Gets called when an error event is emitted.
     * @param secure if this is the secure server.
     * @param err the error.
     */
    protected _event_error(secure: boolean, err: Error): void {
        this.emit('server_error', secure, err);
    }

    /**
     * Gets called when a new client has connected.
     * @param secure if this is the secure server.
     * @param socket the socket.
     */
    protected _event_connection(secure: boolean, socket: net.Socket | tls.TLSSocket): void {
        const smtp_socket: SmtpSocket = new SmtpSocket(secure, socket);
        smtp_socket.on('close', (_: boolean) => this.emit('client_disconnected', secure, smtp_socket));
        smtp_socket.set_timeout(this.timeout);

        const session: SmtpServerSession = new SmtpServerSession();
        const connection: SmtpServerConnection = new SmtpServerConnection(this, smtp_socket, session); // The instance will listen and just handle the stuff.
        connection.begin();

        this.emit('client_connected', secure, smtp_socket);
    }
}
