import { promisify } from "util";
import _pidusage from "pidusage";

const pidusage = promisify(_pidusage);

setInterval(async () => {
  const usage = await pidusage(process.pid);
  console.log("[usage] %d MB", Math.round(usage.memory / 1024 ** 2));
}, 1000);
