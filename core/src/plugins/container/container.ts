/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import chalk from "chalk"
import { keyBy, omit } from "lodash"

import { ConfigurationError } from "../../exceptions"
import { createGardenPlugin } from "../../plugin/plugin"
import { containerHelpers } from "./helpers"
import {
  ContainerActionConfig,
  ContainerBuildActionConfig,
  ContainerModule,
  ContainerModuleVolumeSpec,
  ContainerRuntimeActionConfig,
  containerModuleOutputsSchema,
  containerModuleSpecSchema,
  defaultDockerfileName,
} from "./moduleConfig"
import { buildContainer, getContainerBuildActionOutputs, getContainerBuildStatus } from "./build"
import { ConfigureModuleParams } from "../../plugin/handlers/Module/configure"
import { SuggestModulesParams, SuggestModulesResult } from "../../plugin/handlers/Module/suggest"
import { listDirectory } from "../../util/fs"
import { dedent } from "../../util/string"
import { Provider, GenericProviderConfig, providerConfigBaseSchema } from "../../config/provider"
import { GetModuleOutputsParams } from "../../plugin/handlers/Module/get-outputs"
import { ConvertModuleParams } from "../../plugin/handlers/Module/convert"
import { ExecActionConfig, ExecBuildConfig } from "../exec/config"
import {
  containerBuildOutputsSchema,
  containerDeploySchema,
  containerRunActionSchema,
  containerTestActionSchema,
  containerBuildSpecSchema,
  containerDeployOutputsSchema,
  containerTestOutputSchema,
  containerRunOutputSchema,
  ContainerRuntimeAction,
} from "./config"
import { publishContainerBuild } from "./publish"
import { Resolved } from "../../actions/types"
import { getDeployedImageId } from "../kubernetes/container/util"
import { KubernetesProvider } from "../kubernetes/config"
import { DeepPrimitiveMap } from "../../config/common"
import { DEFAULT_DEPLOY_TIMEOUT_SEC } from "../../constants"

export interface ContainerProviderConfig extends GenericProviderConfig {}

export type ContainerProvider = Provider<ContainerProviderConfig>

// TODO: remove in 0.14. validation should be in the action validation handler.
export async function configureContainerModule({ log, moduleConfig }: ConfigureModuleParams<ContainerModule>) {
  // validate services
  moduleConfig.serviceConfigs = moduleConfig.spec.services.map((spec) => {
    // make sure ports are correctly configured
    const name = spec.name
    const definedPorts = spec.ports
    const portsByName = keyBy(spec.ports, "name")

    for (const ingress of spec.ingresses) {
      const ingressPort = ingress.port

      if (!portsByName[ingressPort]) {
        throw new ConfigurationError(`Service ${name} does not define port ${ingressPort} defined in ingress`, {
          definedPorts,
          ingressPort,
        })
      }
    }

    if (spec.healthCheck && spec.healthCheck.httpGet) {
      const healthCheckHttpPort = spec.healthCheck.httpGet.port

      if (!portsByName[healthCheckHttpPort]) {
        throw new ConfigurationError(
          `Service ${name} does not define port ${healthCheckHttpPort} defined in httpGet health check`,
          { definedPorts, healthCheckHttpPort }
        )
      }
    }

    if (spec.healthCheck && spec.healthCheck.tcpPort) {
      const healthCheckTcpPort = spec.healthCheck.tcpPort

      if (!portsByName[healthCheckTcpPort]) {
        throw new ConfigurationError(
          `Service ${name} does not define port ${healthCheckTcpPort} defined in tcpPort health check`,
          { definedPorts, healthCheckTcpPort }
        )
      }
    }

    for (const volume of spec.volumes) {
      if (volume.module) {
        moduleConfig.build.dependencies.push({ name: volume.module, copy: [] })
        spec.dependencies.push(volume.module)
      }
    }

    return {
      name,
      dependencies: spec.dependencies,
      disabled: spec.disabled,
      spec,
    }
  })

  moduleConfig.testConfigs = moduleConfig.spec.tests.map((t) => {
    for (const volume of t.volumes) {
      if (volume.module) {
        moduleConfig.build.dependencies.push({ name: volume.module, copy: [] })
        t.dependencies.push(volume.module)
      }
    }

    return {
      name: t.name,
      dependencies: t.dependencies,
      disabled: t.disabled,
      spec: t,
      timeout: t.timeout,
    }
  })

  moduleConfig.taskConfigs = moduleConfig.spec.tasks.map((t) => {
    for (const volume of t.volumes) {
      if (volume.module) {
        moduleConfig.build.dependencies.push({ name: volume.module, copy: [] })
        t.dependencies.push(volume.module)
      }
    }

    return {
      name: t.name,
      cacheResult: t.cacheResult,
      dependencies: t.dependencies,
      disabled: t.disabled,
      spec: t,
      timeout: t.timeout,
    }
  })

  // All the config keys that affect the build version
  moduleConfig.buildConfig = {
    buildArgs: moduleConfig.spec.buildArgs,
    targetImage: moduleConfig.spec.build?.targetImage,
    extraFlags: moduleConfig.spec.extraFlags,
    dockerfile: moduleConfig.spec.dockerfile,
  }

  // Automatically set the include field based on the Dockerfile and config, if not explicitly set
  if (!(moduleConfig.include || moduleConfig.exclude)) {
    moduleConfig.include = await containerHelpers.autoResolveIncludes(moduleConfig, log)
  }

  return { moduleConfig }
}

async function suggestModules({ name, path }: SuggestModulesParams): Promise<SuggestModulesResult> {
  const dockerfiles = (await listDirectory(path, { recursive: false })).filter(
    (filename) => filename.startsWith(defaultDockerfileName) || filename.endsWith(defaultDockerfileName)
  )

  return {
    suggestions: dockerfiles.map((dockerfileName) => {
      return {
        description: `based on found ${chalk.white(dockerfileName)}`,
        module: {
          kind: "Module",
          type: "container",
          name,
          dockerfile: dockerfileName,
        },
      }
    }),
  }
}

export async function getContainerModuleOutputs({ moduleConfig, version }: GetModuleOutputsParams) {
  const deploymentImageName = containerHelpers.getDeploymentImageName(
    moduleConfig.name,
    moduleConfig.spec.image,
    undefined
  )
  const deploymentImageId = containerHelpers.getModuleDeploymentImageId(moduleConfig, version, undefined)

  // If there is no Dockerfile (i.e. we don't need to build anything) we use the image field directly.
  // Otherwise we set the tag to the module version.
  const hasDockerfile = containerHelpers.moduleHasDockerfile(moduleConfig, version)
  const localImageId =
    moduleConfig.spec.image && !hasDockerfile
      ? moduleConfig.spec.image
      : containerHelpers.getLocalImageId(moduleConfig.name, moduleConfig.spec.image, version)

  return {
    outputs: {
      "local-image-name": containerHelpers.getLocalImageName(moduleConfig.name, moduleConfig.spec.image),
      "local-image-id": localImageId,
      "deployment-image-name": deploymentImageName,
      "deployment-image-id": deploymentImageId,
    },
  }
}

function convertContainerModuleRuntimeActions(
  convertParams: ConvertModuleParams<ContainerModule>,
  buildAction: ContainerBuildActionConfig | ExecBuildConfig | undefined,
  needsContainerBuild: boolean
) {
  const { module, services, tasks, tests, prepareRuntimeDependencies } = convertParams
  const actions: ContainerActionConfig[] = []

  let deploymentImageId = module.spec.image
  if (deploymentImageId) {
    // If `module.spec.image` is set, but the image id is missing a tag, we need to add the module version as the tag.
    deploymentImageId = containerHelpers.getModuleDeploymentImageId(module, module.version, undefined)
  }

  const volumeModulesReferenced: string[] = []
  function configureActionVolumes(action: ContainerRuntimeActionConfig, volumeSpec: ContainerModuleVolumeSpec[]) {
    volumeSpec.forEach((v) => {
      const referencedPvcAction = v.module ? { kind: <"Deploy">"Deploy", name: v.module } : undefined
      action.spec.volumes.push({
        ...omit(v, "module"),
        action: referencedPvcAction,
      })
      if (referencedPvcAction) {
        action.dependencies?.push(referencedPvcAction)
      }
      if (v.module) {
        volumeModulesReferenced.push(v.module)
      }
    })
    return action
  }

  for (const service of services) {
    const action: ContainerActionConfig = {
      kind: "Deploy",
      type: "container",
      name: service.name,
      ...convertParams.baseFields,

      disabled: service.disabled,
      build: buildAction?.name,
      dependencies: prepareRuntimeDependencies(service.spec.dependencies, buildAction),

      timeout: service.spec.timeout || DEFAULT_DEPLOY_TIMEOUT_SEC,
      spec: {
        ...omit(service.spec, ["name", "dependencies", "disabled"]),
        image: deploymentImageId,
        volumes: [],
      },
    }
    actions.push(configureActionVolumes(action, service.config.spec.volumes))
  }

  for (const task of tasks) {
    const action: ContainerActionConfig = {
      kind: "Run",
      type: "container",
      name: task.name,
      ...convertParams.baseFields,

      disabled: task.disabled,
      build: buildAction?.name,
      dependencies: prepareRuntimeDependencies(task.spec.dependencies, buildAction),
      timeout: task.spec.timeout,

      spec: {
        ...omit(task.spec, ["name", "dependencies", "disabled", "timeout"]),
        image: needsContainerBuild ? undefined : module.spec.image,
        volumes: [],
      },
    }
    actions.push(configureActionVolumes(action, task.config.spec.volumes))
  }

  for (const test of tests) {
    const action: ContainerActionConfig = {
      kind: "Test",
      type: "container",
      name: module.name + "-" + test.name,
      ...convertParams.baseFields,

      disabled: test.disabled,
      build: buildAction?.name,
      dependencies: prepareRuntimeDependencies(test.spec.dependencies, buildAction),
      timeout: test.spec.timeout,

      spec: {
        ...omit(test.spec, ["name", "dependencies", "disabled", "timeout"]),
        image: needsContainerBuild ? undefined : module.spec.image,
        volumes: [],
      },
    }
    actions.push(configureActionVolumes(action, test.config.spec.volumes))
  }

  return { actions, volumeModulesReferenced }
}

export async function convertContainerModule(params: ConvertModuleParams<ContainerModule>) {
  const { module, convertBuildDependency, dummyBuild } = params
  const actions: (ContainerActionConfig | ExecActionConfig)[] = []

  let needsContainerBuild = false

  if (containerHelpers.moduleHasDockerfile(module, module.version)) {
    needsContainerBuild = true
  }

  let buildAction: ContainerActionConfig | ExecActionConfig | undefined = undefined

  if (needsContainerBuild) {
    buildAction = {
      kind: "Build",
      type: "container",
      name: module.name,
      ...params.baseFields,

      copyFrom: dummyBuild?.copyFrom,
      allowPublish: module.allowPublish,
      dependencies: module.build.dependencies.map(convertBuildDependency),
      timeout: module.build.timeout,

      spec: {
        buildArgs: module.spec.buildArgs,
        dockerfile: module.spec.dockerfile || defaultDockerfileName,
        extraFlags: module.spec.extraFlags,
        localId: module.spec.image,
        publishId: module.spec.image,
        targetStage: module.spec.build.targetImage,
      },
    }
    actions.push(buildAction)
  } else if (dummyBuild) {
    buildAction = dummyBuild
    actions.push(buildAction)
  }

  const { actions: runtimeActions, volumeModulesReferenced } = convertContainerModuleRuntimeActions(
    params,
    buildAction,
    needsContainerBuild
  )
  actions.push(...runtimeActions)
  if (buildAction) {
    buildAction.dependencies = buildAction?.dependencies?.filter((d) => !volumeModulesReferenced.includes(d.name))
  }

  return {
    group: {
      // This is an annoying TypeScript limitation :P
      kind: <"Group">"Group",
      name: module.name,
      path: module.path,
      actions,
    },
  }
}

export const gardenPlugin = () =>
  createGardenPlugin({
    name: "container",
    docs: dedent`
      Provides the \`container\` actions and module type.
      _Note that this provider is currently automatically included, and you do not need to configure it in your project configuration._
    `,
    configSchema: providerConfigBaseSchema(),

    createActionTypes: {
      Build: [
        {
          name: "container",
          docs: dedent`
            Build a Docker container image, and (if applicable) push to a remote registry.
          `,
          staticOutputsSchema: containerBuildOutputsSchema(),
          schema: containerBuildSpecSchema(),
          handlers: {
            async getOutputs({ action }) {
              // TODO: figure out why this cast is needed here
              return {
                outputs: getContainerBuildActionOutputs(action) as unknown as DeepPrimitiveMap,
              }
            },

            build: buildContainer,
            getStatus: getContainerBuildStatus,
            publish: publishContainerBuild,
          },
        },
      ],
      Deploy: [
        {
          name: "container",
          docs: dedent`
            Deploy a container image, e.g. in a Kubernetes namespace (when used with the \`kubernetes\` provider).

            This is a simplified abstraction, which can be convenient for simple deployments, but has limited features compared to more platform-specific types. For example, you cannot specify replicas for redundancy, and various platform-specific options are not included. For more flexibility, please look at other Deploy types like [helm](./helm.md) or [kubernetes](./kubernetes.md).
          `,
          schema: containerDeploySchema(),
          staticOutputsSchema: containerDeployOutputsSchema(),
          handlers: {
            // Other handlers are implemented by other providers (e.g. kubernetes)
            async configure({ config }) {
              return { config, supportedModes: { sync: !!config.spec.sync, local: !!config.spec.localMode } }
            },

            async validate({ action }) {
              // make sure ports are correctly configured
              validateRuntimeCommon(action)
              const spec = action.getSpec()
              const definedPorts = spec.ports
              const portsByName = keyBy(spec.ports, "name")

              for (const ingress of spec.ingresses) {
                const ingressPort = ingress.port

                if (!portsByName[ingressPort]) {
                  throw new ConfigurationError(
                    `${action.longDescription()} does not define port ${ingressPort} defined in ingress`,
                    {
                      definedPorts,
                      ingressPort,
                    }
                  )
                }
              }

              if (spec.healthCheck && spec.healthCheck.httpGet) {
                const healthCheckHttpPort = spec.healthCheck.httpGet.port

                if (!portsByName[healthCheckHttpPort]) {
                  throw new ConfigurationError(
                    `${action.longDescription()} does not define port ${healthCheckHttpPort} defined in httpGet health check`,
                    { definedPorts, healthCheckHttpPort }
                  )
                }
              }

              if (spec.healthCheck && spec.healthCheck.tcpPort) {
                const healthCheckTcpPort = spec.healthCheck.tcpPort

                if (!portsByName[healthCheckTcpPort]) {
                  throw new ConfigurationError(
                    `${action.longDescription()} does not define port ${healthCheckTcpPort} defined in tcpPort health check`,
                    { definedPorts, healthCheckTcpPort }
                  )
                }
              }

              return {}
            },

            async getOutputs({ ctx, action }) {
              const provider = ctx.provider as KubernetesProvider
              return {
                outputs: {
                  deployedImageId: getDeployedImageId(action, provider),
                },
              }
            },
          },
        },
      ],
      Run: [
        {
          name: "container",
          docs: dedent`
            Run a command in a container image, e.g. in a Kubernetes namespace (when used with the \`kubernetes\` provider).

            This is a simplified abstraction, which can be convenient for simple tasks, but has limited features compared to more platform-specific types. For example, you cannot specify replicas for redundancy, and various platform-specific options are not included. For more flexibility, please look at other Run types like [kubernetes-pod](./kubernetes-pod.md).
          `,
          schema: containerRunActionSchema(),
          runtimeOutputsSchema: containerRunOutputSchema(),
          handlers: {
            // Implemented by other providers (e.g. kubernetes)
            async validate({ action }) {
              validateRuntimeCommon(action)
              return {}
            },
          },
        },
      ],
      Test: [
        {
          name: "container",
          docs: dedent`
            Define a Test which runs a command in a container image, e.g. in a Kubernetes namespace (when used with the \`kubernetes\` provider).

            This is a simplified abstraction, which can be convenient for simple scenarios, but has limited features compared to more platform-specific types. For example, you cannot specify replicas for redundancy, and various platform-specific options are not included. For more flexibility, please look at other Test types like [kubernetes-pod](./kubernetes-pod.md).
          `,
          schema: containerTestActionSchema(),
          runtimeOutputsSchema: containerTestOutputSchema(),
          handlers: {
            // Implemented by other providers (e.g. kubernetes)
            async validate({ action }) {
              validateRuntimeCommon(action)
              return {}
            },
          },
        },
      ],
    },

    createModuleTypes: [
      {
        name: "container",
        docs: dedent`
          Specify a container image to build or pull from a remote registry.
          You may also optionally specify services to deploy, tasks or tests to run inside the container.

          Note that the runtime services have somewhat limited features in this module type. For example, you cannot
          specify replicas for redundancy, and various platform-specific options are not included. For those, look at
          other module types like [helm](./helm.md) or
          [kubernetes](./kubernetes.md).
        `,
        moduleOutputsSchema: containerModuleOutputsSchema(),
        schema: containerModuleSpecSchema(),
        needsBuild: true,
        handlers: {
          configure: configureContainerModule,
          suggestModules,
          getModuleOutputs: getContainerModuleOutputs,
          convert: convertContainerModule,
        },
      },
    ],

    tools: [
      {
        name: "docker",
        version: "20.10.9",
        description: "The official Docker CLI.",
        type: "binary",
        _includeInGardenImage: true,
        builds: [
          {
            platform: "darwin",
            architecture: "amd64",
            url: "https://download.docker.com/mac/static/stable/x86_64/docker-20.10.9.tgz",
            sha256: "f045f816579a96a45deef25aaf3fc116257b4fb5782b51265ad863dcae21f879",
            extract: {
              format: "tar",
              targetPath: "docker/docker",
            },
          },
          {
            platform: "darwin",
            architecture: "arm64",
            url: "https://download.docker.com/mac/static/stable/aarch64/docker-20.10.9.tgz",
            sha256: "e41cc3b53b9907ee038c7a1ab82c5961815241180fefb49359d820d629658e6b",
            extract: {
              format: "tar",
              targetPath: "docker/docker",
            },
          },
          {
            platform: "linux",
            architecture: "amd64",
            url: "https://download.docker.com/linux/static/stable/x86_64/docker-20.10.9.tgz",
            sha256: "caf74e54b58c0b38bb4d96c8f87665f29b684371c9a325562a3904b8c389995e",
            extract: {
              format: "tar",
              targetPath: "docker/docker",
            },
          },
          {
            platform: "windows",
            architecture: "amd64",
            url: "https://github.com/rgl/docker-ce-windows-binaries-vagrant/releases/download/v20.10.9/docker-20.10.9.zip",
            sha256: "360ca42101d453022eea17747ae0328709c7512e71553b497b88b7242b9b0ee4",
            extract: {
              format: "zip",
              targetPath: "docker/docker.exe",
            },
          },
        ],
      },
    ],
  })

function validateRuntimeCommon(action: Resolved<ContainerRuntimeAction>) {
  const { build } = action.getConfig()
  const { image, volumes } = action.getSpec()

  if (!build && !image) {
    throw new ConfigurationError(`${action.longDescription()} must specify one of \`build\` or \`spec.image\``, {
      actionKey: action.key(),
    })
  } else if (build && image) {
    throw new ConfigurationError(
      `${action.longDescription()} specifies both \`build\` and \`spec.image\`. Only one may be specified.`,
      {
        actionKey: action.key(),
      }
    )
  } else if (build) {
    const buildAction = action.getDependency({ kind: "Build", name: build }, { includeDisabled: true })
    if (buildAction && !buildAction?.isCompatible("container")) {
      throw new ConfigurationError(
        `${action.longDescription()} build field must specify a container Build, or a compatible type.`,
        {
          actionKey: action.key(),
          buildActionName: build,
        }
      )
    }
  }

  for (const volume of volumes) {
    if (volume.action && !action.hasDependency(volume.action)) {
      throw new ConfigurationError(
        `${action.longDescription()} references action ${
          volume.action
        } under \`spec.volumes\` but does not declare a dependency on it. Please add an explicit dependency on the volume action.`,
        { volume }
      )
    }
  }
}
