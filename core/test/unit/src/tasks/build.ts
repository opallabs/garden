/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import tmp from "tmp-promise"
import { expect } from "chai"
import type { ProjectConfig } from "../../../../src/config/project"
import { freezeTime, createProjectConfig, makeTempDir, TestGarden } from "../../../helpers"
import { GardenPlugin, createGardenPlugin } from "../../../../src/plugin/plugin"
import { joi } from "../../../../src/config/common"
import { ConfigGraph } from "../../../../src/graph/config-graph"
import { BuildTask } from "../../../../src/tasks/build"

describe("BuildTask", () => {
  let tmpDir: tmp.DirectoryResult
  let garden: TestGarden
  let graph: ConfigGraph
  let config: ProjectConfig
  let testPlugin: GardenPlugin

  before(async () => {
    tmpDir = await makeTempDir({ git: true, initialCommit: false })

    config = createProjectConfig({
      path: tmpDir.path,
      providers: [{ name: "test" }],
    })

    testPlugin = createGardenPlugin({
      name: "test",
      docs: "asd",
      createActionTypes: {
        Build: [
          {
            name: "test",
            docs: "asd",
            schema: joi.object(),
            handlers: {
              getStatus: async (_) => {
                return {
                  state: "ready",
                  detail: { state: "ready" },
                  outputs: {},
                }
              },
              build: async (_) => {
                return { state: "ready", detail: {}, outputs: {} }
              },
            },
          },
        ],
      },
    })
    garden = await TestGarden.factory(tmpDir.path, { config, plugins: [testPlugin] })

    garden.setActionConfigs([
      {
        name: "test-build",
        type: "test",
        kind: "Build",
        internal: {
          basePath: garden.projectRoot,
        },
        dependencies: [],
        disabled: false,

        spec: {
          log: "",
        },
      },
    ])

    graph = await garden.getConfigGraph({ log: garden.log, emit: false })
  })

  after(async () => {
    await tmpDir.cleanup()
  })

  describe("process", () => {
    it("should emit buildStatus events", async () => {
      garden.events.eventLog = []
      const action = graph.getBuild("test-build")

      const buildTask = new BuildTask({
        garden,
        log: garden.log,
        graph,
        action,
        force: true,
        forceBuild: false,
      })

      const now = freezeTime().toISOString()
      await garden.processTasks({ tasks: [buildTask], throwOnError: true })

      const buildStatusEvents = garden.events.eventLog.filter((e) => e.name === "buildStatus")
      const actionVersion = buildStatusEvents[0].payload.actionVersion
      const actionUid = buildStatusEvents[0].payload.actionUid

      expect(buildStatusEvents).to.eql([
        {
          name: "buildStatus",
          payload: {
            actionName: "test-build",
            actionVersion,
            actionType: "build",
            actionKind: "build",
            actionUid,
            moduleName: null,
            startedAt: now,
            force: true,
            operation: "getStatus",
            state: "getting-status",
            status: { state: "unknown" },
          },
        },
        {
          name: "buildStatus",
          payload: {
            actionName: "test-build",
            actionVersion,
            actionType: "build",
            actionKind: "build",
            actionUid,
            moduleName: null,
            startedAt: now,
            completedAt: now,
            force: true,
            operation: "getStatus",
            state: "cached",
            status: { state: "fetched" },
          },
        },
        {
          name: "buildStatus",
          payload: {
            actionName: "test-build",
            actionVersion,
            actionType: "build",
            actionKind: "build",
            actionUid,
            moduleName: null,
            startedAt: now,
            force: true,
            operation: "process",
            state: "processing",
            status: { state: "building" },
          },
        },
        {
          name: "buildStatus",
          payload: {
            actionName: "test-build",
            actionVersion,
            actionType: "build",
            actionKind: "build",
            actionUid,
            moduleName: null,
            startedAt: now,
            completedAt: now,
            force: true,
            operation: "process",
            state: "ready",
            status: { state: "built" },
          },
        },
      ])
    })
    it("should NOT emit buildStatus events if statusOnly=true", async () => {
      garden.events.eventLog = []
      const action = graph.getBuild("test-build")

      const buildTask = new BuildTask({
        garden,
        log: garden.log,
        graph,
        action,
        force: true,
        forceBuild: false,
      })

      await garden.processTasks({ tasks: [buildTask], throwOnError: true, statusOnly: true })

      const buildStatusEvents = garden.events.eventLog.filter((e) => e.name === "buildStatus")

      expect(buildStatusEvents).to.eql([])
    })
  })
})
