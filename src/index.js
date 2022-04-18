import Fastify from "fastify";
import config from "./config.js";
import handleUpload from "./routes/handleUpload.js";
import fs from "fs";

const tempContents = fs.readdirSync("/tmp");
console.log("Temp:", tempContents);

const fastify = Fastify({
  logger: {
    prettyPrint: true,
  },
});

fastify.post("/upload", handleUpload);

try {
  await fastify.listen(config.port, config.host);
} catch (error) {
  fastify.log.error(error);
  process.exit(1);
}
