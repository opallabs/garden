/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import type { ValuesType } from "utility-types"
import type { ConfigGraph, ResolvedConfigGraph } from "../graph/config-graph"
import type { ActionReference, DeepPrimitiveMap } from "../config/common"
import type { ModuleVersion, TreeVersion } from "../vcs/vcs"
import type { BuildAction, BuildActionConfig, ExecutedBuildAction, ResolvedBuildAction } from "./build"
import type { DeployAction, DeployActionConfig, ExecutedDeployAction, ResolvedDeployAction } from "./deploy"
import type { ExecutedRunAction, ResolvedRunAction, RunAction, RunActionConfig } from "./run"
import type { ExecutedTestAction, ResolvedTestAction, TestAction, TestActionConfig } from "./test"
import type { ActionKind } from "../plugin/action-types"
import type { GraphResults } from "../graph/results"
import type { BaseAction } from "./base"
import type { ValidResultType } from "../tasks/base"
import type { BaseGardenResource, GardenResourceInternalFields } from "../config/base"
import type { LinkedSource } from "../config-store/local"

// TODO: split this file

export type { ActionKind } from "../plugin/action-types"

export const actionKinds: ActionKind[] = ["Build", "Deploy", "Run", "Test"]
export const actionKindsLower = actionKinds.map((k) => k.toLowerCase())

interface SourceRepositorySpec {
  url: string
  // TODO: subPath?: string
  // TODO: commitHash?: string
}

export interface ActionSourceSpec {
  path?: string
  repository?: SourceRepositorySpec
}

/**
 * These are the built-in fields in all action configs.
 *
 * See inline comments below for information on what templating is allowed on different fields.
 */
export interface BaseActionConfig<K extends ActionKind = ActionKind, T = string, Spec = any>
  extends BaseGardenResource {
  // Basics
  // -> No templating is allowed on these.
  apiVersion?: string
  kind: K
  type: T
  name: string
  description?: string

  // Location
  // -> Templating with ActionConfigContext allowed
  source?: ActionSourceSpec

  // Internal metadata
  // -> No templating is allowed on these.
  internal: GardenResourceInternalFields & {
    groupName?: string
    resolved?: boolean // Set to true if no resolution is required, e.g. set for actions converted from modules
    treeVersion?: TreeVersion // Set during module resolution to avoid duplicate scanning for Build actions
    // For forwards-compatibility, applied on actions returned from module conversion handlers
    remoteClonePath?: string
    moduleName?: string
    moduleVersion?: ModuleVersion
  }

  // Flow/execution control
  // -> Templating with ActionConfigContext allowed
  dependencies?: ActionReference[]
  disabled?: boolean

  // Version/file handling
  // -> Templating with ActionConfigContext allowed
  include?: string[]
  exclude?: string[]

  timeout: number

  // Variables
  // -> Templating with ActionConfigContext allowed
  variables?: DeepPrimitiveMap
  // -> Templating with ActionConfigContext allowed, including in variables defined in the varfiles
  varfiles?: string[]

  // Type-specific
  spec: Spec
}

export interface ActionConfigTypes {
  Build: BuildActionConfig<string, any>
  Deploy: DeployActionConfig<string, any>
  Run: RunActionConfig<string, any>
  Test: TestActionConfig<string, any>
}

/**
 * These are the states returned from actions and used internally by Garden. Note that
 * the Action statuses we emit to Cloud have slightly different semantics (e.g. there we use
 * "cached" instead of "ready")
 *
 * See https://melvingeorge.me/blog/convert-array-into-string-literal-union-type-typescript
 */
export const actionStateTypes = ["ready", "not-ready", "processing", "failed", "unknown"] as const
export type ActionState = (typeof actionStateTypes)[number]

export interface ActionStatus<
  T extends BaseAction = BaseAction,
  D extends {} = any,
  O extends {} = GetActionOutputType<T>
> extends ValidResultType {
  state: ActionState
  detail: D | null
  outputs: O
}

export interface ActionStatusMap<T extends BaseAction = BaseAction> {
  [key: string]: ActionStatus<T>
}

export interface ActionDependencyAttributes {
  explicit: boolean // Set to true if action config explicitly states the dependency
  needsStaticOutputs: boolean // Set to true if action cannot be resolved without resolving the dependency
  needsExecutedOutputs: boolean // Set to true if action cannot be resolved without the dependency executed
}

export type ActionDependency = ActionReference & ActionDependencyAttributes

export interface ActionModes {
  sync?: boolean
  local?: boolean
}

export type ActionMode = keyof ActionModes | "default"

export type ActionModeMap = {
  [mode in ActionMode]?: string[]
}

export interface ActionWrapperParams<C extends BaseActionConfig> {
  baseBuildDirectory: string // <project>/.garden/build by default
  compatibleTypes: string[]
  config: C
  dependencies: ActionDependency[]
  graph: ConfigGraph
  linkedSource: LinkedSource | null
  moduleName?: string
  moduleVersion?: ModuleVersion
  mode: ActionMode
  projectRoot: string
  remoteSourcePath: string | null
  supportedModes: ActionModes
  treeVersion: TreeVersion
  variables: DeepPrimitiveMap
}

export interface ResolveActionParams<C extends BaseActionConfig, StaticOutputs extends {} = any> {
  resolvedGraph: ResolvedConfigGraph
  dependencyResults: GraphResults
  executedDependencies: ExecutedAction[]
  resolvedDependencies: ResolvedAction[]
  spec: C["spec"]
  staticOutputs: StaticOutputs
  inputs: DeepPrimitiveMap
  variables: DeepPrimitiveMap
}

export type ResolvedActionWrapperParams<
  C extends BaseActionConfig,
  StaticOutputs extends {} = any
> = ActionWrapperParams<C> & ResolveActionParams<C, StaticOutputs>

export interface ExecuteActionParams<
  C extends BaseActionConfig = BaseActionConfig,
  StaticOutputs extends {} = any,
  RuntimeOutputs extends {} = any
> {
  status: ActionStatus<BaseAction<C, StaticOutputs>, any, RuntimeOutputs>
}

export type ExecutedActionWrapperParams<
  C extends BaseActionConfig,
  StaticOutputs extends {} = any,
  RuntimeOutputs extends {} = any
> = ResolvedActionWrapperParams<C, StaticOutputs> & ExecuteActionParams<C, StaticOutputs, RuntimeOutputs>

export type GetActionOutputType<T> = T extends BaseAction<any, infer O> ? O : any

export function actionReferenceToString(ref: ActionReference) {
  return `${ref.kind.toLowerCase()}.${ref.name}`
}

export type ActionConfig = ValuesType<ActionConfigTypes>
export type Action = BuildAction | DeployAction | RunAction | TestAction
export type ResolvedAction = ResolvedBuildAction | ResolvedDeployAction | ResolvedRunAction | ResolvedTestAction
export type ExecutedAction = ExecutedBuildAction | ExecutedDeployAction | ExecutedRunAction | ExecutedTestAction

export type Resolved<T extends BaseAction> = T extends BuildAction
  ? ResolvedBuildAction<T["_config"], T["_staticOutputs"], T["_runtimeOutputs"]>
  : T extends DeployAction
  ? ResolvedDeployAction<T["_config"], T["_staticOutputs"], T["_runtimeOutputs"]>
  : T extends RunAction
  ? ResolvedRunAction<T["_config"], T["_staticOutputs"], T["_runtimeOutputs"]>
  : T extends TestAction
  ? ResolvedTestAction<T["_config"], T["_staticOutputs"], T["_runtimeOutputs"]>
  : T

export type Executed<T extends BaseAction> = T extends BuildAction
  ? ExecutedBuildAction<T["_config"], T["_staticOutputs"], T["_runtimeOutputs"]>
  : T extends DeployAction
  ? ExecutedDeployAction<T["_config"], T["_staticOutputs"], T["_runtimeOutputs"]>
  : T extends RunAction
  ? ExecutedRunAction<T["_config"], T["_staticOutputs"], T["_runtimeOutputs"]>
  : T extends TestAction
  ? ExecutedTestAction<T["_config"], T["_staticOutputs"], T["_runtimeOutputs"]>
  : T

export type ActionReferenceMap = {
  [K in ActionKind]: string[]
}

export type ActionConfigMap = {
  [K in ActionKind]: {
    [name: string]: BaseActionConfig<K>
  }
}

export interface ActionConfigsByKey {
  [key: string]: ActionConfig
}

export type GetOutputValueType<K, StaticOutputs, RuntimeOutputs> = K extends keyof StaticOutputs
  ? StaticOutputs[K]
  : K extends keyof RuntimeOutputs
  ? RuntimeOutputs[K] | undefined
  : never

