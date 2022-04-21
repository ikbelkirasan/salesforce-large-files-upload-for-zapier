import { PassThrough, pipeline, finished } from "stream";
import fetch from "node-fetch";
import { Throttle } from "stream-throttle";
import deferred from "defer-promise";
import CustomFormData from "../helpers/CustomFormData.js";

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
    const { body: fileBodyStream, fileSize } = await startFileDownload(fileUrl);

    const { stream: fileContents, promise: writingPromise } = pPipeline(
      fileBodyStream,
      new Throttle({ rate: 20 * 1024 ** 2 }),
      new PassThrough()
    );

    const formData = new CustomFormData()
      .appendJson("entity_content", metadata)
      .appendStream("VersionData", fileContents, metadata.Title, fileSize)
      .finalize();

    // Start the upload
    const [response] = await Promise.all([
      uploadToSalesforce({
        accessToken,
        body: formData.getBody(),
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
