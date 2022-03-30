import net, { NetConnectOpts } from 'net';
import { EventEmitter } from 'events';
import tls from 'tls';
import assert from 'assert';

export declare interface SmtpSocket {
    on(event: 'close', listener: () => void): this;
    on(event: 'connect', listener: () => void): this;
    on(event: 'upgrade', listener: () => void): this;
    on(event: 'data', listener: (chunk: Buffer) => void): this;
}

export class SmtpSocket extends EventEmitter {
    /**
     * Constructs a new SmtpSocket.
     * @param secure if the socket is secure.
     * @param socket the socket.
     */
    public constructor(public secure: boolean, public socket?: net.Socket | tls.TLSSocket) {
        super();

        if (!socket) {
            return;
        }

        this._initialize();
    }

    ////////////////////////////////////////////////
    // Private Instance Methods
    ////////////////////////////////////////////////

    /**
     * Initializes the socket, and does stuff such as registering the events.
     */
    protected _initialize(): void {
        this._assert_socket();

        this.socket!.on('close', () => this._event_close());
        this.socket!.on('data', (data: Buffer) => this._event_data(data));
        this.socket!.on('error', (err: Error) => this._event_error(err));
        this.socket!.on('timeout', () => this._event_timeout());
    }

    /**
     * Asserts the socket exists.
     */
    protected _assert_socket(): void {
        assert.notEqual(this.socket, undefined, "This operation is ony allowed with a valid socket.");
    }

    /**
     * Asserts that the socket does not exists.
     */
    protected _assert_not_socket(): void {
        assert.equal(this.socket, undefined, "This operation is only allowed when there is no socket yet.");
    }

    ////////////////////////////////////////////////
    // Getters
    ////////////////////////////////////////////////

    /**
     * Gets the address string.
     */
    public get address(): string {
        this._assert_socket();

        if (!this.socket!.remoteAddress) {
            throw new Error('Socket is not connected!');
        }

        return this.socket!.remoteAddress;
    }

    /**
     * Gets the port.
     */
    public get port(): number {
        this._assert_socket();

        if (!this.socket!.remotePort) {
            throw new Error('Socket is not connected!');
        }

        return this.socket!.remotePort;
    }

    /**
     * Gets the socket family.
     */
    public get family(): string {
        this._assert_socket();

        if (!this.socket!.remoteFamily) {
            throw new Error('Socket is not connected!');
        }

        return this.socket!.remoteFamily;
    }

    ////////////////////////////////////////////////
    // Instance Methods
    ////////////////////////////////////////////////

    /**
     * Closes the socket.
     */
    public close(): void {
        this._assert_socket();

        this.socket!.end();
    }

    /**
     * Pauses.
     */
    public pause(): void {
        this._assert_socket();

        this.socket!.pause();
    }

    /**
     * Resumes.
     */
    public resume(): void {
        this._assert_socket();

        this.socket!.resume();
    }

    /**
     * Sets the socket timeout.
     * @param timeout the timeout.
     * @returns ourselves.
     */
    public set_timeout(timeout: number): SmtpSocket {
        this._assert_socket();

        this.socket!.setTimeout(timeout);

        return this;
    }

    /**
     * Writes the given data to the socket.
     * @param data the data to write.
     * @returns All written.
     */
    public write(data: string | Buffer): boolean {
        this._assert_socket();

        return this.socket!.write(data);
    }

    /**
     * Connects the socket.
     * @param secure if it's a TLS socket.
     * @param host the host.
     * @param port the port.
     */
    public connect(secure: boolean, host: string, port: number): void {
        this._assert_not_socket();

        if (secure) {
            this.socket = tls.connect({
                host, port
            }, () => this._event_connect());
        } else {
            this.socket = net.connect({
                host, port
            }, () => this._event_connect());
        }
    }

    /**
     * Upgrades the current socket to TLS.
     */
    public upgrade(): void {
        this._assert_socket();

        if (this.secure) {
            return;
        }

        this.secure = true;
        this.socket = tls.connect({
            socket: this.socket,
            rejectUnauthorized: false,
        }, () => this._event_upgrade());
    }


    ////////////////////////////////////////////////
    // Event Listeners
    ////////////////////////////////////////////////

    /**
     * Gets called when the socket was closed.
     */
    protected _event_close(): void {
        this.emit('close');
    }

    /**
     * Gets called when there is data available.
     * @param data the data.
     */
    protected _event_data(data: Buffer): void {
        this.emit('data', data);
    }

    /**
     * Gets called when an error occured.
     * @param err the error.
     */
    protected _event_error(err: Error): void {
        this.socket!.destroy();
        this.emit('error', err);
    }

    /**
     * Gets called when an timeout occured.
     */
    protected _event_timeout(): void {
        this.socket!.end();

        this.emit('timeout');
    }

    /**
     * Gets called when the socket is connected.
     */
    protected _event_connect(): void {
        // Initializes the event listeners.
        this._initialize();

        // Emits the event that we're connected.
        this.emit('connect');
    }

    /**
     * Gets called when the socket is upgraded.
     */
    protected _event_upgrade(): void {
        this._initialize();

        this.emit('upgrade');
    }
}