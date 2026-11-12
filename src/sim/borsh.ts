import bs58 from 'bs58';

export class Reader {
  private view: DataView;
  offset = 0;

  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining() {
    return this.bytes.length - this.offset;
  }

  private need(n: number) {
    if (this.offset + n > this.bytes.length)
      throw new RangeError(`read past end (${this.offset}+${n} > ${this.bytes.length})`);
  }

  u8() {
    this.need(1);
    return this.view.getUint8(this.offset++);
  }
  i8() {
    this.need(1);
    return this.view.getInt8(this.offset++);
  }
  u16() {
    this.need(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }
  i16() {
    this.need(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }
  i32() {
    this.need(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }
  u64() {
    this.need(8);
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }
  i64() {
    this.need(8);
    const v = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return v;
  }
  u128() {
    const lo = this.u64();
    const hi = this.u64();
    return (hi << 64n) | lo;
  }
  i128() {
    const v = this.u128();
    return v >= 1n << 127n ? v - (1n << 128n) : v;
  }
  f32() {
    this.need(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }
  f64() {
    this.need(8);
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }
  bool() {
    return this.u8() !== 0;
  }
  bytesN(n: number) {
    this.need(n);
    const v = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }
  pubkey() {
    return bs58.encode(this.bytesN(32));
  }
  string() {
    return new TextDecoder().decode(this.bytesN(this.u32()));
  }
}
