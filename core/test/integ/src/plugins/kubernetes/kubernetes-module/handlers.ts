/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { expect } from "chai"
import execa from "execa"
import { cloneDeep } from "lodash"
import tmp from "tmp-promise"

import { TestGarden } from "../../../../../helpers"
import { getKubernetesTestGarden } from "./common"
import { DeployTask } from "../../../../../../src/tasks/deploy"
import { getManifests } from "../../../../../../src/plugins/kubernetes/kubernetes-type/common"
import { KubeApi } from "../../../../../../src/plugins/kubernetes/api"
import { ActionLog, createActionLog, Log } from "../../../../../../src/logger/log-entry"
import { KubernetesPluginContext, KubernetesProvider } from "../../../../../../src/plugins/kubernetes/config"
import { getActionNamespace } from "../../../../../../src/plugins/kubernetes/namespace"
import { getDeployedResource } from "../../../../../../src/plugins/kubernetes/status/status"
import { ModuleConfig } from "../../../../../../src/config/module"
import { BaseResource, KubernetesResource } from "../../../../../../src/plugins/kubernetes/types"
import { DeleteDeployTask } from "../../../../../../src/tasks/delete-deploy"
import {
  kubernetesDeploy,
  getKubernetesDeployStatus,
} from "../../../../../../src/plugins/kubernetes/kubernetes-type/handlers"
import Bluebird from "bluebird"
import { buildHelmModules } from "../helm/common"
import { gardenAnnotationKey } from "../../../../../../src/util/string"
import { LocalModeProcessRegistry, ProxySshKeystore } from "../../../../../../src/plugins/kubernetes/local-mode"
import { KubernetesDeployAction } from "../../../../../../src/plugins/kubernetes/kubernetes-type/config"
import { DEFAULT_BUILD_TIMEOUT_SEC, GardenApiVersion } from "../../../../../../src/constants"
import { ActionModeMap } from "../../../../../../src/actions/types"
import { NamespaceStatus } from "../../../../../../src/types/namespace"

describe("kubernetes-module handlers", () => {
  let tmpDir: tmp.DirectoryResult
  let garden: TestGarden
  let log: Log
  let actionLog: ActionLog
  let ctx: KubernetesPluginContext
  let api: KubeApi
  /**
   * To speed up the test suite, getKubernetesTestGarden caches a garden instance to avoid repeatedly resolving
   * providers for the various integ test cases that use it.
   *
   * Therefore, when overriding the module configs in a test case, we restore the original module configs when we're
   * done.
   */
  let moduleConfigBackup: ModuleConfig[]
  let nsModuleConfig: ModuleConfig
  let ns1Manifest: KubernetesResource<BaseResource> | undefined
  let ns1Resource: KubernetesResource<BaseResource> | null
  let ns2Manifest: KubernetesResource<BaseResource> | undefined
  let ns2Resource: KubernetesResource<BaseResource> | null

  const withNamespace = (moduleConfig: ModuleConfig, nsName: string): ModuleConfig => {
    const cloned = cloneDeep(moduleConfig)
    cloned.spec.manifests[0].metadata.name = nsName
    cloned.spec.manifests[0].metadata.labels.name = nsName
    return cloned
  }

  const findDeployedResources = async (manifests: KubernetesResource<BaseResource>[], logCtx: Log) => {
    const maybeDeployedObjects = await Bluebird.map(manifests, (resource) =>
      getDeployedResource(ctx, ctx.provider, resource, logCtx)
    )
    return <KubernetesResource[]>maybeDeployedObjects.filter((o) => o !== null)
  }

  before(async () => {
    garden = await getKubernetesTestGarden()
    moduleConfigBackup = await garden.getRawModuleConfigs()
    log = garden.log
    actionLog = createActionLog({ log, actionName: "", actionKind: "" })
    const provider = <KubernetesProvider>await garden.resolveProvider(log, "local-kubernetes")
    ctx = <KubernetesPluginContext>(
      await garden.getPluginContext({ provider, templateContext: undefined, events: undefined })
    )
    api = await KubeApi.factory(log, ctx, ctx.provider)
    tmpDir = await tmp.dir({ unsafeCleanup: true })
    await execa("git", ["init", "--initial-branch=main"], { cwd: tmpDir.path })
    nsModuleConfig = {
      apiVersion: GardenApiVersion.v0,
      kind: "Module",
      disabled: false,
      allowPublish: false,
      build: { dependencies: [], timeout: DEFAULT_BUILD_TIMEOUT_SEC },
      description: "Kubernetes module that includes a Namespace resource",
      name: "namespace-resource",
      path: tmpDir.path,
      serviceConfigs: [],
      spec: {
        manifests: [
          {
            apiVersion: "v1",
            kind: "Namespace",
            metadata: {
              name: "kubernetes-module-ns-1",
              labels: { name: "kubernetes-module-ns-1" },
            },
          },
        ],
        serviceResource: {
          kind: "Deployment",
          name: "busybox-deployment",
        },
        build: { dependencies: [] },
      },
      testConfigs: [],
      type: "kubernetes",
      taskConfigs: [],
    }

    const graph = await garden.getConfigGraph({ log: garden.log, emit: false })
    await buildHelmModules(garden, graph)
  })

  after(async () => {
    garden.setModuleConfigs(moduleConfigBackup)
    await tmpDir.cleanup()
    if (garden) {
      garden.close()
    }
  })

  describe("getServiceStatus", () => {
    it("should return not-ready status for a manifest with a missing resource type", async () => {
      const graph = await garden.getConfigGraph({ log: garden.log, emit: false })
      const action = await garden.resolveAction<KubernetesDeployAction>({
        action: graph.getDeploy("module-simple"),
        log: garden.log,
        graph,
      })
      const deployParams = {
        ctx,
        log: actionLog,
        action,
        force: false,
      }
      action["_config"].spec.manifests = [
        {
          apiVersion: "foo.bar/baz",
          kind: "Whatever",
          metadata: { name: "foo" },
          spec: {},
        },
      ]

      const status = await getKubernetesDeployStatus(deployParams)
      expect(status.state).to.equal("not-ready")
    })
  })

  describe("kubernetesDeploy", () => {
    async function getTestData(actionName: string, mode: ActionModeMap) {
      const graph = await garden.getConfigGraph({
        log: garden.log,
        emit: false,
        actionModes: mode,
      })
      const action = graph.getDeploy(actionName)
      const resolvedAction = await garden.resolveAction<KubernetesDeployAction>({ action, log: garden.log, graph })
      const deployParams = {
        ctx,
        log: actionLog,
        action: resolvedAction,
        force: false,
      }
      const namespace = await getActionNamespace({
        ctx,
        log,
        action: resolvedAction,
        provider: ctx.provider,
        skipCreate: true,
      })
      const manifests = await getManifests({
        ctx,
        api,
        log,
        action: resolvedAction,
        defaultNamespace: namespace,
        readFromSrcDir: true,
      })
      return { deployParams, manifests }
    }

    it("should successfully deploy when serviceResource doesn't have a containerModule", async () => {
      const graph = await garden.getConfigGraph({ log: garden.log, emit: false })
      const action = graph.getDeploy("module-simple")
      const deployParams = {
        ctx,
        log: actionLog,
        action: await garden.resolveAction<KubernetesDeployAction>({ action, log: garden.log, graph }),
        force: false,
      }

      // Here, we're not going through a router, so we listen for the `namespaceStatus` event directly.
      let namespaceStatus: NamespaceStatus | null = null
      ctx.events.once("namespaceStatus", (status) => namespaceStatus = status)
      const status = await kubernetesDeploy(deployParams)
      expect(status.state).to.eql("ready")
      expect(namespaceStatus).to.exist
      expect(namespaceStatus!.namespaceName).to.eql("kubernetes-module-test-default")
    })

    it("should toggle sync mode", async () => {
      const syncData = await getTestData("with-source-module", {
        sync: ["deploy.with-source-module"],
      })
      const defaultData = await getTestData("with-source-module", {
        default: ["deploy.with-source-module"],
      })

      // Deploy without sync mode
      await kubernetesDeploy(defaultData.deployParams)
      const res1 = await findDeployedResources(defaultData.manifests, log)

      // Deploy with sync mode
      await kubernetesDeploy(syncData.deployParams)
      const res2 = await findDeployedResources(syncData.manifests, log)

      // Deploy without sync mode again
      await kubernetesDeploy(defaultData.deployParams)
      const res3 = await findDeployedResources(defaultData.manifests, log)

      expect(res1[0].metadata.annotations![gardenAnnotationKey("mode")]).to.equal("default")
      expect(res2[0].metadata.annotations![gardenAnnotationKey("mode")]).to.equal("sync")
      expect(res3[0].metadata.annotations![gardenAnnotationKey("mode")]).to.equal("default")
    })

    it("should handle local mode", async () => {
      const localData = await getTestData("with-source-module", {
        local: ["deploy.with-source-module"],
      })
      const defaultData = await getTestData("with-source-module", {
        default: ["deploy.with-source-module"],
      })

      // Deploy without local mode
      await kubernetesDeploy(defaultData.deployParams)
      const res1 = await findDeployedResources(defaultData.manifests, log)

      // Deploy with local mode
      await kubernetesDeploy(localData.deployParams)
      const res2 = await findDeployedResources(localData.manifests, log)
      // shut down local app and tunnels to avoid retrying after redeploy
      LocalModeProcessRegistry.getInstance().shutdown()
      ProxySshKeystore.getInstance(log).shutdown(log)

      // Deploy without local mode again
      await kubernetesDeploy(defaultData.deployParams)
      const res3 = await findDeployedResources(defaultData.manifests, log)

      expect(res1[0].metadata.annotations![gardenAnnotationKey("mode")]).to.equal("default")
      expect(res2[0].metadata.annotations![gardenAnnotationKey("mode")]).to.equal("local")
      expect(res3[0].metadata.annotations![gardenAnnotationKey("mode")]).to.equal("default")
    })

    it("should not delete previously deployed namespace resources", async () => {
      garden.setModuleConfigs([withNamespace(nsModuleConfig, "kubernetes-module-ns-1")])
      let graph = await garden.getConfigGraph({ log, emit: false })
      let action = graph.getDeploy("namespace-resource")
      const resolvedAction = await garden.resolveAction<KubernetesDeployAction>({ action, log: garden.log, graph })
      const defaultNamespace = await getActionNamespace({ ctx, log, action: resolvedAction, provider: ctx.provider })
      let manifests = await getManifests({ ctx, api, log, action: resolvedAction, defaultNamespace })
      ns1Manifest = manifests.find((resource) => resource.kind === "Namespace")

      const deployTask = new DeployTask({
        garden,
        graph,
        log,
        action,
        force: true,
        forceBuild: false,
      })
      const results = await garden.processTasks({ tasks: [deployTask], throwOnError: true })
      ns1Resource = await getDeployedResource(ctx, ctx.provider, ns1Manifest!, log)

      expect(ns1Manifest, "ns1Manifest").to.exist
      expect(ns1Manifest!.metadata.name).to.match(/ns-1/)
      expect(ns1Resource, "ns1Resource").to.exist
      // Here, we expect one status for the app namespace, and one status for the namespace resource defined by
      // this module.

      // This should result in a new namespace with a new name being deployed.
      garden.setModuleConfigs([withNamespace(nsModuleConfig, "kubernetes-module-ns-2")])
      graph = await garden.getConfigGraph({ log, emit: false })
      action = graph.getDeploy("namespace-resource")
      manifests = await getManifests({
        ctx,
        api,
        log,
        action: await garden.resolveAction({ action, log: garden.log, graph }),
        defaultNamespace,
      })
      ns2Manifest = manifests.find((resource) => resource.kind === "Namespace")
      const deployTask2 = new DeployTask({
        garden,
        graph,
        log,
        action,
        force: true,
        forceBuild: true,
      })
      await garden.processTasks({ tasks: [deployTask2], throwOnError: true })
      ns2Resource = await getDeployedResource(ctx, ctx.provider, ns2Manifest!, log)

      expect(ns2Manifest, "ns2Manifest").to.exist
      expect(ns2Manifest!.metadata.name).to.match(/ns-2/)
      expect(ns2Resource, "ns2Resource").to.exist

      // Finally, we verify that the original namespace resource is still in the cluster.
      const ns1ResourceRefreshed = await getDeployedResource(ctx, ctx.provider, ns1Manifest!, log)

      expect(ns1ResourceRefreshed, "originalNamespaceRefreshed").to.exist
    })

    it("should successfully deploy List manifest kinds", async () => {
      const configMapList = await getTestData("config-map-list", {})

      // this should be 3, and not 1, as we transform *List objects to separate manifests
      expect(configMapList.manifests.length).to.be.equal(3)

      // test successful deploy
      await kubernetesDeploy(configMapList.deployParams)
    })
  })

  describe("deleteService", () => {
    it("should only delete namespace resources having the current name in the manifests", async () => {
      // First, we verify that the namespaces created in the preceding test case are still there.
      expect(await getDeployedResource(ctx, ctx.provider, ns1Manifest!, log), "ns1resource").to.exist
      expect(await getDeployedResource(ctx, ctx.provider, ns2Manifest!, log), "ns2resource").to.exist

      const graph = await garden.getConfigGraph({ log, emit: false })
      const deleteServiceTask = new DeleteDeployTask({
        garden,
        graph,
        log,
        action: graph.getDeploy("namespace-resource"),
        force: false,
      })

      // This should only delete kubernetes-module-ns-2.
      await garden.processTasks({ tasks: [deleteServiceTask], throwOnError: true })

      expect(await getDeployedResource(ctx, ctx.provider, ns1Manifest!, log), "ns1resource").to.exist
      expect(await getDeployedResource(ctx, ctx.provider, ns2Manifest!, log), "ns2resource").to.not.exist
    })
  })
})
