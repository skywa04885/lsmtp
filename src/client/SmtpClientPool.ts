import { EventEmitter } from "events";
import { LinkedList } from "../helpers/LinkedList";
import { Logger } from "../helpers/Logger";
import { Queue } from "../helpers/Queue";
import { SmtpClientAssignment } from "./SmtpCommanderAssignment";
import { SmtpClientCommander } from "./SmtpClientCommander";

export interface SmtpClientPoolOptions {
    max_assgn_per_client?: number; // the max number of assignments per client.
    debug?: boolean; // If debug mode enabled.
}

export interface SmtpClientPoolNode {
    commander: SmtpClientCommander; // The client commander (abstraction over the SmtpClient).
    queue: Queue<SmtpClientAssignment>; // The assignment queue.
    total_enqueued: number; // The total number of enqueued transfers.
    total_complete: number; // The total number of completed transfers.
}

export declare interface SmtpClientPool {
    on(event: 'destroy', listener: () => void): this;
}

const SmtpClientPoolLogger: Logger = new Logger('SmtpClientPool');

export class SmtpClientPool extends EventEmitter {
    protected _max_assgn_per_client: number;
    protected _debug: boolean;

    protected _nodes: LinkedList<SmtpClientPoolNode>;

    public constructor(options: SmtpClientPoolOptions = {}) {
        super();

        // Sets the options.
        this._max_assgn_per_client = options.max_assgn_per_client ?? 5;
        this._debug = options.debug ?? false;

        // Sets the default values for the instance variables.
        this._nodes = new LinkedList<SmtpClientPoolNode>();
    }

    public assign(assignment: SmtpClientAssignment) {
        // Checks if the newest created node has no more space for another assignment, if so enqueue
        //  a new node onto the list.
        if (this._nodes.size > 0 && this._nodes.head.total_enqueued < this._max_assgn_per_client) {
            // Creates the commander.
            const commander: SmtpClientCommander = new SmtpClientCommander();

            // Creates the node.
            const node: SmtpClientPoolNode = {
                commander,
                queue: new Queue<SmtpClientAssignment>(),
                total_complete: 0,
                total_enqueued: 0,
            }
            
            // Registers the destroy event listener, get's called when the commander has been destroyed.
            commander.once('destroy', (): void => {
                this._nodes.remove(node);
            });

            // Registers the intial ready listener, this will execute the assignment, and listen for the other
            //  ready events.
            commander.once('ready', (): void => {
                commander.assign(assignment);
                
                commander.on('ready', (): void => {
                    ++node.total_complete;
                });
            });

            // Pushes the node.
            this._nodes.push_head(node);
        }
    }
}