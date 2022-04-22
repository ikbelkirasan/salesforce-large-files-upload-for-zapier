//@ts-check

import { Transform } from "stream";
import { TokenBucket } from "limiter";

export class Throttle extends Transform {
  constructor(opts) {
    super(opts);
    const group = new ThrottleGroup(opts);
    this.bucket = group.bucket;
    this.chunksize = group.chunksize;
  }

  _transform(chunk, encoding, done) {
    this.process(chunk, 0, done);
  }

  process(chunk, pos, done) {
    let slice = chunk.slice(pos, pos + this.chunksize);
    if (!slice.length) {
      // chunk fully consumed
      done();
      return;
    }

    this.bucket.removeTokens(slice.length, (err) => {
      if (err) {
        done(err);
        return;
      }
      this.push(slice);
      this.process(chunk, pos + this.chunksize, done);
    });
  }
}

class ThrottleGroup {
  constructor(opts = {}) {
    if (opts.rate === undefined)
      throw new Error("throttle rate is a required argument");
    if (typeof opts.rate !== "number" || opts.rate <= 0)
      throw new Error("throttle rate must be a positive number");
    if (
      opts.chunksize !== undefined &&
      (typeof opts.chunksize !== "number" || opts.chunksize <= 0)
    ) {
      throw new Error("throttle chunk size must be a positive number");
    }

    this.rate = opts.rate;
    this.chunksize = opts.chunksize || this.rate / 10;
    this.bucket = new TokenBucket(this.rate, this.rate, "second", null);
  }
}
