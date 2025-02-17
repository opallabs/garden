/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { isEmpty, isString } from "lodash"
import { stringify } from "yaml"
import { withoutInternalFields, sanitizeValue } from "./util/logging"
import { testFlags } from "./util/util"

export interface GardenError<D extends object = any> extends Error {
  type: string
  message: string
  detail?: D
  stack?: string
}

export abstract class GardenBaseError<D extends object = any> extends Error implements GardenError<D> {
  abstract type: string

  constructor(message: string, public readonly detail: D, public readonly wrappedError?: Error) {
    super(message)
    this.detail = detail
  }

  toString() {
    if (testFlags.expandErrors) {
      let str = super.toString()

      if (this.wrappedError) {
        str += "\n\nWrapped error:\n\n" + this.wrappedError
      }

      return str
    } else {
      return super.toString()
    }
  }

  toSanitizedValue() {
    return {
      type: this.type,
      message: this.message,
      stack: this.stack,
      detail: filterErrorDetail(this.detail),
    }
  }

  formatWithDetail() {
    return formatGardenErrorWithDetail(this)
  }
}

export class AuthenticationError extends GardenBaseError {
  type = "authentication"
}

export class BuildError extends GardenBaseError {
  type = "build"
}

export class ConfigurationError extends GardenBaseError {
  type = "configuration"
}

export class CommandError extends GardenBaseError {
  type = "command"
}

export class FilesystemError extends GardenBaseError {
  type = "filesystem"
}

export class LocalConfigError extends GardenBaseError {
  type = "local-config"
}

export class ValidationError extends GardenBaseError {
  type = "validation"
}

export class PluginError extends GardenBaseError {
  type = "plugin"
}

export class ParameterError extends GardenBaseError {
  type = "parameter"
}

export class NotImplementedError extends GardenBaseError {
  type = "not-implemented"
}

export class DeploymentError extends GardenBaseError {
  type = "deployment"
}

export class RuntimeError extends GardenBaseError {
  type = "runtime"
}

export class InternalError extends GardenBaseError {
  type = "internal"

  constructor(message: string, detail: any) {
    super(message + "\nThis is a bug. Please report it!", detail)
  }
}

export class TimeoutError extends GardenBaseError {
  type = "timeout"
}

export class OutOfMemoryError extends GardenBaseError {
  type = "out-of-memory"
}

export class NotFoundError extends GardenBaseError {
  type = "not-found"
}

export class WorkflowScriptError extends GardenBaseError {
  type = "workflow-script"
}

export class CloudApiError extends GardenBaseError {
  type = "cloud-api"
}

export class TemplateStringError extends GardenBaseError {
  type = "template-string"
}

interface ErrorEvent {
  error: any
  message: string
}

export function toGardenError(err: Error | ErrorEvent | GardenBaseError | string): GardenBaseError {
  if (err instanceof GardenBaseError) {
    return err
  } else if (err instanceof Error) {
    const out = new RuntimeError(err.message, err)
    out.stack = err.stack
    return out
  } else if (!isString(err) && err.message && err.error) {
    return new RuntimeError(err.message, err)
  } else if (isString(err)) {
    return new RuntimeError(err, {})
  } else {
    const msg = err["message"]
    return new RuntimeError(msg, err)
  }
}

function filterErrorDetail(detail: any) {
  return withoutInternalFields(sanitizeValue(detail))
}

export function formatGardenErrorWithDetail(error: GardenError) {
  const { detail, message, stack } = error
  let out = stack || message || ""

  // We sanitize and recursively filter out internal fields (i.e. having names starting with _).
  const filteredDetail = filterErrorDetail(detail)

  if (!isEmpty(filteredDetail)) {
    try {
      const yamlDetail = stringify(filteredDetail, { blockQuote: "literal", lineWidth: 0 })
      out += `\n\nError Details:\n\n${yamlDetail}`
    } catch (err) {
      out += `\n\nUnable to render error details:\n${err.message}`
    }
  }
  return out
}
