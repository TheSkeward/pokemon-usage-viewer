/**
 * @fileoverview A minimal Ruby Marshal (version 4.8) reader — just the subset
 * needed to read Reborn's compiled `mons.dat` (a MonDataHash of species →
 * MonWrapper → MonData). Maintains the symbol table and object link table
 * that Marshal uses for back-references (`;` symlinks and `@` object links).
 */

/**
 * Parses a Marshal payload into JS values: Ruby Hash → Map, String →
 * {rubyString}, Symbol → RubySymbol, generic object → RubyObject.
 * @param {!Buffer} buffer
 * @return {*} The root value.
 */
export function parseMarshal(buffer) {
  const reader = new MarshalReader(buffer);
  reader.expectVersion();
  return reader.readValue();
}

/**
 * Wrapper markers so consumers can distinguish Ruby symbols/objects from plain
 * strings and maps after parsing.
 */
export class RubySymbol {
  constructor(name) {
    this.name = name;
  }
}
/** A parsed Ruby object: its class name plus an ivar-name → value Map. */
export class RubyObject {
  constructor(className) {
    this.className = className;
    this.ivars = new Map();
  }
}

class MarshalReader {
  constructor(buffer) {
    this.buf = buffer;
    this.pos = 0;
    this.symbols = [];
    this.objects = [];
  }

  expectVersion() {
    const major = this.buf[this.pos++];
    const minor = this.buf[this.pos++];
    if (major !== 4 || minor > 8) {
      throw new Error(`Unsupported Marshal version ${major}.${minor}`);
    }
  }

  byte() {
    return this.buf[this.pos++];
  }

  // Marshal's variable-length signed integer encoding.
  long() {
    const c = (this.byte() << 24) >> 24; // sign-extend to int8
    if (c === 0) return 0;
    if (c > 0) {
      if (c > 4) return c - 5;
      let n = 0;
      for (let i = 0; i < c; i++) n += this.byte() * 2 ** (8 * i);
      return n;
    }
    if (c < -4) return c + 5;
    let n = -1;
    const count = -c;
    for (let i = 0; i < count; i++) {
      const mask = ~(0xff * 2 ** (8 * i));
      n = (n & mask) + this.byte() * 2 ** (8 * i);
    }
    return n;
  }

  bytes(n) {
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  string() {
    return this.bytes(this.long()).toString('latin1');
  }

  registerObject(obj) {
    this.objects.push(obj);
    return obj;
  }

  readValue() {
    const type = String.fromCharCode(this.byte());
    switch (type) {
      case '0':
        return null;
      case 'T':
        return true;
      case 'F':
        return false;
      case 'i':
        return this.long();
      case ':': {
        const sym = new RubySymbol(this.string());
        this.symbols.push(sym);
        return sym;
      }
      case ';':
        return this.symbols[this.long()];
      case '@':
        return this.objects[this.long()];
      case '"': {
        const obj = { rubyString: this.string() };
        return this.registerObject(obj);
      }
      case 'I': {
        // Object with instance vars (usually a String carrying @encoding).
        const inner = this.readValue();
        const ivarCount = this.long();
        for (let i = 0; i < ivarCount; i++) {
          this.readValue(); // key (symbol)
          this.readValue(); // value
        }
        return inner;
      }
      case '[': {
        const arr = this.registerObject([]);
        const count = this.long();
        for (let i = 0; i < count; i++) arr.push(this.readValue());
        return arr;
      }
      case '{': {
        const map = this.registerObject(new Map());
        const count = this.long();
        for (let i = 0; i < count; i++) {
          const key = this.readValue();
          map.set(key, this.readValue());
        }
        return map;
      }
      case 'o': {
        const className = this.readValue().name;
        const obj = this.registerObject(new RubyObject(className));
        const count = this.long();
        for (let i = 0; i < count; i++) {
          const key = this.readValue().name;
          obj.ivars.set(key, this.readValue());
        }
        return obj;
      }
      case 'C': {
        // User subclass of a builtin (e.g. MonDataHash < Hash): class name, then
        // the wrapped builtin object.
        this.readValue(); // class-name symbol
        return this.readValue();
      }
      case 'U': {
        // marshal_dump: class symbol, then the dumped object.
        this.readValue();
        return this.readValue();
      }
      case 'u': {
        // _dump userdef: class symbol, then a byte string. Keep raw.
        const className = this.readValue().name;
        const raw = this.bytes(this.long());
        return this.registerObject({ rubyUserdef: className, raw });
      }
      case 'f': {
        const obj = { rubyFloat: Number(this.string()) };
        return this.registerObject(obj);
      }
      case 'e': {
        this.readValue(); // extended module symbol
        return this.readValue();
      }
      default:
        throw new Error(
          `Unhandled Marshal type '${type}' (0x${type
            .charCodeAt(0)
            .toString(16)}) at byte ${this.pos - 1}`,
        );
    }
  }
}
