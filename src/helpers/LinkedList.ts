export interface LinkedListNode<T> {
    data: T;
    next: LinkedListNode<T> | null;
    prev: LinkedListNode<T> | null;
}

export class LinkedList<T> {
    protected _tail: LinkedListNode<T> | null = null;
    protected _head: LinkedListNode<T> | null = null;
    protected _size: number = 0;

    /**
     * Gets the size of the linked list.
     */
    public get size(): number {
        return this._size;
    }

    /**
     * Returns if the linked list is empty.
     */
    public get empty(): boolean {
        return this.size === 0;
    }

    /**
     * Pushes a new node to the linked list at the head position.
     * @param data the data,
     */
    public push_head(data: T): void {
        let node: LinkedListNode<T> = {
            data,
            next: null,
            prev: null,
        };

        // If the size is 0 at start, make the node the head
        //  and the tail, and return.
        if (this._size++ === 0) {
            this._head = this._tail = node;
            return;
        }

        // @ts-ignore
        this._head.next = node;         // The next of the current head is the node.
        node.prev = this._head;         // The prev of the new node is the old head.
        this._head = node;              // The new head is the node.
    }

    /**
     * Gets the head of the linked list.
     */
    public get head(): T {
        if (this.empty) {
            throw new Error('Linked list is empty.');
        }

        // @ts-ignore
        return this._head.data;
    }

    /**
     * Pushes a new node to the linked list at the head position.
     * @param data the data,
     */
    public push_tail(data: T): void {
        let node: LinkedListNode<T> = {
            data,
            next: null,
            prev: null,
        };

        // If the size is 0 at start, make the node the head
        //  and the tail, and return.
        if (++this._size === 1) {
            this._head = this._tail = node;
            return;
        }

        // @ts-ignore
        this._tail.prev = node;         // The previous node of the current tail is the new node.
        node.next = this._tail;         // The next node is the old tail.
        this._tail = node;              // The new node is the tail.
    }

    /**
     * Pops the tail.
     */
    public pop_tail(): T {
        if (this.empty) {
            throw new Error('Linked list is empty.');
        }

        // @ts-ignore
        const node: LinkedListNode<T> = this._tail;

        // Removes the element from the tail.
        if (--this._size === 0) {
            // Sets the head and tail to null.
            this._tail = this._head = null;
        } else {
            // Makes the next of the tail, the new tail.
            let new_tail: LinkedListNode<T> = (this._tail?.next as LinkedListNode<T>);
            new_tail.prev = null;
            this._tail = new_tail;
        }

        // Returns the popped data.
        return node.data;
    }

    /**
     * Gets the tail of the linked list.
     */
    public get tail(): T {
        if (this.empty) {
            throw new Error('Linked list is empty.');
        }

        // @ts-ignore
        return this._tail.data;
    }
}