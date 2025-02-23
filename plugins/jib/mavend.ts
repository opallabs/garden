/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import AsyncLock from "async-lock"
import { Log, PluginContext, PluginToolSpec } from "@garden-io/sdk/types"
import { find } from "lodash"
import { PluginError } from "@garden-io/core/build/src/exceptions"
import { Writable } from "node:stream"
import execa from "execa"

const buildLock = new AsyncLock()

const mvndVersion = "0.9.0"

const mvndSpec = {
  description: "The Maven Daemon CLI.",
  baseUrl: `https://github.com/apache/maven-mvnd/releases/download/${mvndVersion}/`,
  linux: {
    filename: `maven-mvnd-${mvndVersion}-linux-amd64.tar.gz`,
    sha256: "64acc68f2a3e25a0662eb62bf87cf2641706245505572ca1d20f933c7190f148",
    targetPath: `maven-mvnd-${mvndVersion}-linux-amd64/bin/mvnd`,
  },
  darwin_aarch64: {
    filename: `maven-mvnd-${mvndVersion}-darwin-aarch64.tar.gz`,
    sha256: "bca67a44cc3716a7da46926acff41b3864d62e5da6982b9e998eca42d2f9bfac",
    targetPath: `maven-mvnd-${mvndVersion}-darwin-aarch64/bin/mvnd`,
  },
  darwin_amd64: {
    filename: `maven-mvnd-${mvndVersion}-darwin-amd64.tar.gz`,
    sha256: "b94fb24d92cd971b6368df14f44bf77b5614a422dfe9f6f115b32b11860c1d6b",
    targetPath: `maven-mvnd-${mvndVersion}-darwin-amd64/bin/mvnd`,
  },
  windows: {
    filename: `maven-mvnd-${mvndVersion}-windows-amd64.zip`,
    sha256: "7ddf8204f39ba72e55618cac31cae2ac917ea4f9b74ee3bc808bf5d210139420",
    targetPath: `maven-mvnd-${mvndVersion}-windows-amd64/bin/mvnd.cmd`,
  },
}

export const mavendSpec: PluginToolSpec = {
  name: "mavend",
  version: mvndVersion,
  description: "The Maven Daemon CLI.",
  type: "binary",
  builds: [
    {
      platform: "linux",
      architecture: "amd64",
      sha256: mvndSpec.linux.sha256,
      url: `${mvndSpec.baseUrl}${mvndSpec.linux.filename}`,
      extract: {
        format: "tar",
        targetPath: mvndSpec.linux.targetPath,
      },
    },
    {
      platform: "darwin",
      architecture: "amd64",
      sha256: mvndSpec.linux.sha256,
      url: `${mvndSpec.baseUrl}${mvndSpec.darwin_amd64.filename}`,
      extract: {
        format: "tar",
        targetPath: mvndSpec.darwin_amd64.targetPath,
      },
    },
    {
      platform: "darwin",
      architecture: "aarch64",
      sha256: mvndSpec.linux.sha256,
      url: `${mvndSpec.baseUrl}${mvndSpec.darwin_aarch64.filename}`,
      extract: {
        format: "tar",
        targetPath: mvndSpec.darwin_aarch64.targetPath,
      },
    },
    {
      platform: "windows",
      architecture: "amd64",
      url: `${mvndSpec.baseUrl}${mvndSpec.windows.filename}`,
      sha256: "d53e045bc5c02aad179fae2fbc565d953354880db6661a8fab31f3a718d7b62c",
      extract: {
        format: "zip",
        targetPath: mvndSpec.windows.targetPath,
      },
    },
  ],
}

export function getMvndTool(ctx: PluginContext) {
  const tool = find(ctx.tools, (_, k) => k.endsWith(".mavend"))

  if (!tool) {
    throw new PluginError(`Could not find configured maven daemon tool`, { tools: ctx.tools })
  }

  return tool
}

/**
 * Run mavend with the specified args in the specified directory.
 */
export async function mvnd({
  ctx,
  args,
  cwd,
  log,
  openJdkPath,
  outputStream,
}: {
  ctx: PluginContext
  args: string[]
  cwd: string
  log: Log
  openJdkPath: string
  outputStream?: Writable
}) {
  let mvndPath: string
  log.verbose(`The Maven Daemon binary hasn't been specified explicitly. Maven ${mvndVersion} will be used by default.`)

  const tool = getMvndTool(ctx)
  mvndPath = await tool.ensurePath(log)

  return buildLock.acquire("mvnd", async () => {
    log.debug(`Execing ${mvndPath} ${args.join(" ")}`)

    const res = execa(mvndPath, args, {
      cwd,
      env: {
        JAVA_HOME: openJdkPath,
      },
    })

    if (outputStream) {
      res.stdout?.pipe(outputStream)
      res.stderr?.pipe(outputStream)
    }

    return res
  })
}
