import { finished } from "stream";
import fetch from "node-fetch";
import CustomFormData from "../helpers/CustomFormData.js";

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
    // Start downloading
    const downloadResponse = await fetch(fileUrl);
    if (!downloadResponse.ok) {
      throw new Error("Failed to download the file");
    }

    const formData = new CustomFormData()
      .appendJson("entity_content", metadata)
      .appendStream("VersionData", downloadResponse.body, metadata.Title)
      .finalize();

    const headers = formData.getHeaders();
    const body = formData.getBody();

    // Start the upload
    const response = await new Promise(async (resolve, reject) => {
      finished(body, (error) => {
        if (error) {
          reject(error);
        }
      });

      try {
        const response = await fetch(salesforceEndpoint, {
          method: "post",
          body,
          headers: {
            ...headers,
            Authorization: `Bearer ${accessToken}`,
          },
        });
        resolve(response);
      } catch (error) {
        reject(error);
      }
    });

    // Send back the results to Zapier
    result = await response.json();
    console.log("result:", result);
  } catch (err) {
    error = err;
    console.error(error);
  } finally {
    await fetch(callbackUrl, {
      method: "post",
      body: JSON.stringify({
        error,
        result,
      }),
      headers: {
        "content-type": "application/json",
      },
    });
  }
};

export default async function handleUpload(req, res) {
  perform(req.body);

  return {
    staredAt: new Date().toISOString(),
  };
}
