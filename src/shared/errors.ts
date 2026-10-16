/**
 * 领域错误：错误码 + 人话。工具壳把它折成诚实回执。
 *
 * @module dsh-dataforge/shared/errors
 */

export type DataforgeErrorCode =
  | 'ENGINE_ROOT_MISSING'      // config.engineRoot 未指或目录不存在
  | 'BRIDGE_MISSING'           // dsh_bridge.py 缺失
  | 'PYTHON_UNAVAILABLE'       // pythonBin 不可执行
  | 'FLOW_NOT_FOUND'           // 流程名在所有包里都找不到
  | 'MISSING_FIELDS'           // 闸 1：必填参数缺失
  | 'CONFIRM_REQUIRED'         // 闸 2：未确认
  | 'JOBS_UNAVAILABLE'         // 宿主未装配 dsh-jobs / dsh-tool-jobs
  | 'RUN_NOT_FOUND'            // status 查不到 runId
  | 'OWNER_UNAVAILABLE'        // 取执行窗（session）失败

export class DataforgeError extends Error {
  readonly code: DataforgeErrorCode
  /** 给模型看的可操作明细（missing 清单 / 建议动作）。 */
  readonly hints: string[]

  constructor(code: DataforgeErrorCode, message: string, hints: string[] = []) {
    super(message)
    this.name = 'DataforgeError'
    this.code = code
    this.hints = hints
  }
}
