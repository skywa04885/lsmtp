export class HasFlags {
    protected _flags: number = 0x00000000;

    public set_flags(mask: number) {
        this._flags |= mask;
    }

    public clear_flags(mask: number) {
        this._flags &= ~mask;
    }

    public get_flags(mask: number) {
        return this._flags & mask;
    }

    public are_flags_set(mask: number) {
        return this.get_flags(mask) === mask;
    }

    public are_flags_clear(mask: number) {
        return this.get_flags(mask) === 0;
    }
}