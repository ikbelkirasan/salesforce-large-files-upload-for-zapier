import { Readable } from "stream";
import merge2 from "merge2";

class CombinedStream {
  _streams = [];

  append(stream) {
    this._streams.push(stream);
  }

  get() {
    return merge2(...this._streams, {
      //@ts-ignore
      pipeError: true,
    });
  }
}

export default class CustomFormData {
  _boundary = "";
  _additionalBoundary = "--";
  LF = "\r\n";
  dataStream = new CombinedStream();
  contentLength = 0;

  getBody() {
    return this.dataStream.get();
  }

  getHeaders() {
    return {
      "Content-Length": this.contentLength,
      "Content-Type": "multipart/form-data; boundary=" + this.getBoundary(),
    };
  }

  appendJson(name, value, contentType = "application/json") {
    this.appendString(this.getHeader(name, contentType));
    this.appendString(JSON.stringify(value) + this.LF);
    return this;
  }

  appendStream(
    name,
    stream,
    filename,
    length = 0,
    contentType = "application/octet-stream"
  ) {
    this.appendString(this.getHeader(name, contentType, filename));
    this.dataStream.append(stream);
    this.appendString(this.LF);
    this.contentLength += length;
    return this;
  }

  finalize() {
    this.appendString(this.getFooter());
    return this;
  }

  appendString(value) {
    const length = value.length;
    this.dataStream.append(Readable.from(value));
    this.contentLength += length;
    return this;
  }

  getBoundary() {
    if (!this._boundary) {
      let value = "--------------------------";
      for (let i = 0; i < 24; i++) {
        value += Math.floor(Math.random() * 10).toString(16);
      }
      this._boundary = value;
    }
    return this._boundary;
  }

  getHeader(name, contentType, filename) {
    const additionalBoundary = this._additionalBoundary;
    const boundary = this.getBoundary();

    return [
      [additionalBoundary, boundary].join(""),
      `Content-Type: ${contentType}`,
      [
        "Content-Disposition: form-data",
        `name="${name}"`,
        filename ? `filename="${filename}"` : null,
      ]
        .filter(Boolean)
        .join("; "),
      this.LF,
    ].join(this.LF);
  }

  getFooter() {
    const boundary = this.getBoundary();
    const additionalBoundary = this._additionalBoundary;
    return `${additionalBoundary}${boundary}${additionalBoundary}`;
  }
}
