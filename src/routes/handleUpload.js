import { PassThrough, pipeline, finished } from "stream";
import fetch from "node-fetch";
import deferred from "defer-promise";
import Bandwidth from "stream-bandwidth";
import { Throttle } from "../helpers/StreamThrottle.js";
import CustomFormData from "../helpers/CustomFormData.js";

// TODO: remove
// const emit = IncomingMessage.prototype.emit;
// IncomingMessage.prototype.emit = function (...args) {
//   console.log("[req]", args);
//   return emit.call(this, ...args);
// };
// TODO: remove

const uploadToSalesforce = async ({
  body,
  salesforceEndpoint,
  headers,
  accessToken,
}) => {
  const response = await new Promise(async (resolve, reject) => {
    finished(body, (error) => {
      if (error) {
        reject(error);
      }
    });

    try {
      console.log("Calling salesforce API:", salesforceEndpoint);
      const response = await fetch(salesforceEndpoint, {
        method: "post",
        body,
        headers: {
          ...headers,
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!response.ok) {
        throw new Error(`[${response.status}]` + (await response.text()));
      }
      resolve(response);
    } catch (error) {
      reject(error);
    }
  });

  return response;
};

const startFileDownload = async (fileUrl) => {
  console.log("downloading:", fileUrl);

  // Start downloading
  const downloadResponse = await fetch(fileUrl);
  if (!downloadResponse.ok) {
    throw new Error("Failed to download the file");
  }

  const fileSize = +downloadResponse.headers.get("content-length");
  console.log("file size:", fileSize);

  return {
    body: downloadResponse.body,
    fileSize,
  };
};

const pPipeline = (...args) => {
  const d = deferred();
  const stream = pipeline(...args, (error) => {
    if (error) {
      d.reject(error);
    } else {
      d.resolve();
    }
  });
  return {
    stream,
    promise: d.promise,
  };
};

const perform = async ({
  accessToken,
  salesforceEndpoint,
  fileUrl,
  metadata,
  callbackUrl,
}) => {
  let error = null;
  let result = null;

  try {
    const bw = new Bandwidth();
    bw.on("done", (data) => {
      let c = data.total_bytes / (1024 * 1024);
      c = c.toFixed(2);
      console.log(c + "MB");
    });

    bw.on("progress", (data) => {
      let c = data.bytes / (1024 * 1024);
      c = c.toFixed(2);
      console.log(c + "MB/s");
    });

    // TODO: test salesforce auth here first. Otherwise fail early

    const { body: fileBodyStream, fileSize } = await startFileDownload(fileUrl);

    const passThrough = new PassThrough();

    const { stream: fileContents, promise: writingPromise } = pPipeline(
      fileBodyStream,
      // new Throttle({ rate: 200 * 1024 ** 2 }),
      passThrough,
      bw
    );

    // setTimeout(() => {
    //   passThrough.pause();
    // }, 200);

    const formData = new CustomFormData()
      .appendJson("entity_content", metadata)
      .appendStream("VersionData", fileContents, metadata.Title, fileSize)
      .finalize();

    const body = formData.getBody();

    const pp = pipeline(
      body,
      // new Throttle({ rate: 100 * 1024 ** 2 }),
      new PassThrough(),
      (error) => {
        if (error) {
          console.error("[!]", error);
        }
      }
    );

    // const emit = pp.emit;
    // pp.emit = function (...args) {
    //   console.log("[pp]", args);
    //   return emit.call(this, ...args);
    // };

    // Start the upload
    const [response] = await Promise.all([
      uploadToSalesforce({
        accessToken,
        body: pp,
        headers: formData.getHeaders(),
        salesforceEndpoint,
      }),
      writingPromise,
    ]);

    // Send the results back to Zapier
    result = await response.json();
    console.log("result:", result);
  } catch (err) {
    // Should retry??
    error = err;
    console.error(error);
  } finally {
    console.log({ result, error });
    await fetch(callbackUrl, {
      method: "post",
      body: JSON.stringify({ error, result }),
      headers: {
        "content-type": "application/json",
      },
    });
  }
};

export default async function handleUpload(req, res) {
  console.log("[req]", req.body);
  perform(req.body);

  return {
    startedAt: new Date().toISOString(),
  };
}
