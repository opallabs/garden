/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// These plugins are always registered and the providers documented
export const getSupportedPlugins = () => [
  { name: "container", callback: () => require("./container/container").gardenPlugin() },
  { name: "exec", callback: () => require("./exec/exec").gardenPlugin() },
  { name: "hadolint", callback: () => require("./hadolint/hadolint").gardenPlugin.getSpec() },
  { name: "kubernetes", callback: () => require("./kubernetes/kubernetes").gardenPlugin() },
  { name: "local-kubernetes", callback: () => require("./kubernetes/local/local").gardenPlugin() },
  { name: "openshift", callback: () => require("./openshift/openshift").gardenPlugin() },
  { name: "local-openshift", callback: () => require("./openshift/local/local").gardenPlugin() },
  { name: "octant", callback: () => require("./octant/octant").gardenPlugin() },
]

// These plugins are always registered
export const getBuiltinPlugins = () =>
  getSupportedPlugins().concat([{ name: "templated", callback: () => require("./templated").gardenPlugin() }])
