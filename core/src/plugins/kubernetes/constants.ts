/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { DockerImageWithDigest } from "../../util/string"

export const rsyncPort = 873
export const rsyncPortName = "garden-rsync"
export const buildSyncVolumeName = `garden-sync`

export const CLUSTER_REGISTRY_PORT = 5000
export const CLUSTER_REGISTRY_DEPLOYMENT_NAME = "garden-docker-registry"
export const MAX_CONFIGMAP_DATA_SIZE = 1024 * 1024 // max ConfigMap data size is 1MB
// max ConfigMap data size is 1MB but we need to factor in overhead, plus in some cases the log is duplicated in
// the outputs field, so we cap at 250kB.
export const MAX_RUN_RESULT_LOG_LENGTH = 250 * 1024

export const PROXY_CONTAINER_USER_NAME = "garden-proxy-user"
export const PROXY_CONTAINER_SSH_TUNNEL_PORT = 2222
export const PROXY_CONTAINER_SSH_TUNNEL_PORT_NAME = "garden-prx-ssh"

export const systemDockerAuthSecretName = "builder-docker-config"
export const dockerAuthSecretKey = ".dockerconfigjson"

export const gardenUtilDaemonDeploymentName = "garden-util-daemon"

export const skopeoDaemonContainerName = "util"

export const defaultIngressClass = "nginx"

// Docker images that Garden ships with
export const k8sUtilImageName: DockerImageWithDigest = "gardendev/k8s-util:0.5.6@sha256:dce403dc7951e3f714fbb0157aaa08d010601049ea939517957e46ac332073ad"
export const k8sSyncUtilImageName: DockerImageWithDigest = "gardendev/k8s-sync:0.1.5@sha256:28263cee5ac41acebb8c08f852c4496b15e18c0c94797d7a949a4453b5f91578"
export const k8sReverseProxyImageName: DockerImageWithDigest = "gardendev/k8s-reverse-proxy:0.1.0@sha256:df2976dc67c237114bd9c70e32bfe4d7131af98e140adf6dac29b47b85e07232"
export const buildkitImageName: DockerImageWithDigest = "gardendev/buildkit:v0.10.5-2@sha256:c2199fcdabc2ad10a266aab5acfb7861d934e4a787071c4d717cfcb1b5ab39ed"
export const buildkitRootlessImageName: DockerImageWithDigest = "gardendev/buildkit:v0.10.5-2-rootless@sha256:9d9476286f0bc88ec43b139fa093c4416e521c9bc39e39374c1f40b59be44aed"
export const defaultKanikoImageName: DockerImageWithDigest = "gcr.io/kaniko-project/executor:v1.11.0-debug@sha256:32ba2214921892c2fa7b5f9c4ae6f8f026538ce6b2105a93a36a8b5ee50fe517"

export const buildkitDeploymentName = "garden-buildkit"
export const buildkitContainerName = "buildkitd"
