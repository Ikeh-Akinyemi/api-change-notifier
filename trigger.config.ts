import { defineConfig } from "@trigger.dev/sdk";
import { additionalFiles } from "@trigger.dev/build/extensions/core";
import type { BuildExtension } from "@trigger.dev/build";

const OASDIFF_VERSION = "1.39.0";
const OASDIFF_TARBALL = `oasdiff_${OASDIFF_VERSION}_linux_amd64.tar.gz`;
const OASDIFF_SHA256 = "71a85930728f367a2086077b7ae1411319421549d18473a3e8258b6451520433"; // from the release's checksums.txt

// dev runs tasks locally against whatever oasdiff is on the PATH, so only deploys need it baked in
const oasdiff: BuildExtension = {
  name: "oasdiff",
  onBuildComplete(context) {
    if (context.target === "dev") return;
    context.addLayer({
      id: "oasdiff",
      image: {
        instructions: [
          "RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/* && " +
            `curl -fsSLO https://github.com/oasdiff/oasdiff/releases/download/v${OASDIFF_VERSION}/${OASDIFF_TARBALL} && ` +
            `echo "${OASDIFF_SHA256}  ${OASDIFF_TARBALL}" | sha256sum -c - && ` +
            `tar -xzf ${OASDIFF_TARBALL} -C /usr/local/bin oasdiff && rm ${OASDIFF_TARBALL}`,
        ],
      },
    });
  },
};

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF!,
  dirs: ["./src/trigger"],
  runtime: "node-24",
  // compute time only, waiting on the docs PR doesn't count toward it
  maxDuration: 600,
  // cwd is the build dir in dev and deploy, so data/usage.db resolves the same in both
  legacyDevProcessCwdBehaviour: false,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },
  },
  build: {
    extensions: [additionalFiles({ files: ["./data/usage.db"] }), oasdiff],
  },
});
