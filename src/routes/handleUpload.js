import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline, finished } from "node:stream";
import FormData from "form-data";
import { v4 as uuid } from "uuid";
import axios from "axios";

class TempFile {
  constructor() {
    this.filePath = path.join(os.tmpdir(), uuid());
  }

  getWritableStream() {
    if (!this._writableStream) {
      this._writableStream = fs.createWriteStream(this.filePath);
    }
    return this._writableStream;
  }

  getReadableStream() {
    if (!this._readableStream) {
      this._readableStream = fs.createReadStream(this.filePath);
    }
    return this._readableStream;
  }

  async destroy() {
    try {
      await fs.promises.unlink(this.filePath);
      console.log(`Temp file removed successfully. ${this.filePath}`);
    } catch (error) {
      console.error("Could not delete temp file. " + error.message);
    }
  }
}

class Job {
  constructor({
    accessToken,
    salesforceEndpoint,
    fileUrl,
    metadata,
    callbackUrl,
  }) {
    this.accessToken = accessToken;
    this.salesforceEndpoint = salesforceEndpoint;
    this.fileUrl = fileUrl;
    this.metadata = metadata;
    this.callbackUrl = callbackUrl;
    this.tempFile = new TempFile();
    this.result = null;
    this.error = null;
  }

  async perform() {
    try {
      const { body: fileBodyStream, fileSize } = await this.startFileDownload();

      // Download file into a temporary folder
      await new Promise((resolve, reject) => {
        pipeline(fileBodyStream, this.tempFile.getWritableStream(), (error) => {
          if (error) {
            return reject(error);
          }
          resolve();
        });
      });

      // Generate payload
      const formData = new FormData();
      formData.append("entity_content", JSON.stringify(this.metadata), {
        contentType: "application/json",
      });
      formData.append("VersionData", this.tempFile.getReadableStream(), {
        filename: this.metadata.Title,
        knownLength: fileSize,
      });

      // Start uploading...
      this.result = await this.uploadToSalesforce({
        body: formData,
        headers: formData.getHeaders(),
      });

      console.log("result:", this.result);
    } catch (error) {
      this.error = {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      };
    } finally {
      console.info({ result: this.result, error: this.error });
      await this.tempFile.destroy();
      await this.sendResultsBackToZapier();
    }
  }

  async sendResultsBackToZapier() {
    try {
      await axios.post(this.callbackUrl, {
        error: this.error,
        result: this.result,
      });
    } catch (error) {
      console.error(error.response.status, error.message, error.response?.data);
    }
  }

  async uploadToSalesforce({ body, headers }) {
    const response = await new Promise(async (resolve, reject) => {
      finished(body, (error) => {
        if (error) {
          reject(error);
        }
      });

      try {
        console.log("Calling salesforce API:", this.salesforceEndpoint);
        const response = await axios.post(this.salesforceEndpoint, body, {
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          headers: {
            ...headers,
            Authorization: `Bearer ${this.accessToken}`,
          },
        });
        resolve(response.data);
      } catch (error) {
        reject(error);
      }
    });

    return response;
  }

  async startFileDownload() {
    console.log("downloading:", this.fileUrl);

    // Start downloading
    const downloadResponse = await axios.get(this.fileUrl, {
      responseType: "stream",
    });

    // const fileSize = +downloadResponse.headers.get("content-length");
    const fileSize = +downloadResponse.headers["content-length"];
    console.log("file size:", fileSize);

    return {
      body: downloadResponse.data,
      fileSize,
    };
  }
}

export default async function handleUpload(req) {
  new Job(req.body).perform();

  return {
    startedAt: new Date().toISOString(),
  };
}
