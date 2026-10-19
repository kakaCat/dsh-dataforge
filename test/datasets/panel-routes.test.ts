/**
 * /artifacts 只读面板数据面：列表 + report/dataset/asset 白名单。
 *
 * @module dsh-dataforge/test/datasets/panel-routes
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createArtifactsPanelHandler } from '../../src/datasets/panel-routes.js'

function serve(dataRoot: string, url: string): { handled: boolean; status: number; type: string; body: string } {
  const captured = { status: 0, type: '', body: '' }
  const res = {
    writeHead: (status: number, headers: Record<string, string>) => {
      captured.status = status
      captured.type = headers['content-type'] ?? ''
    },
    end: (body: string | Buffer) => { captured.body = String(body) },
  }
  const handled = createArtifactsPanelHandler({ dataRoot })(
    { method: 'GET', url } as unknown as IncomingMessage,
    res as unknown as ServerResponse,
  )
  return { handled, ...captured }
}

describe('artifacts panel routes', () => {
  it('列表 / report / dataset / asset 白名单', () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'df-artifacts-'))
    mkdirSync(join(dataRoot, 'datasets'), { recursive: true })
    mkdirSync(join(dataRoot, 'evidence', 'run_1'), { recursive: true })
    writeFileSync(join(dataRoot, 'datasets', 'run_1.json'), JSON.stringify({
      kind: 'run-dataset', status: 'completed', site: '示例站点', flow: '创建订单', createdAt: '2026-10-18T00:00:00Z',
    }))
    writeFileSync(join(dataRoot, 'evidence', 'run_1', 'report.html'), '<html>ok</html>')
    writeFileSync(join(dataRoot, 'evidence', 'run_1', 'success.png'), Buffer.from([0x89, 0x50]))

    const list = serve(dataRoot, '/dashboard/api/dataforge/artifacts')
    expect(list.handled).toBe(true)
    expect(list.status).toBe(200)
    expect(list.type).toContain('application/json')
    expect(list.body).toContain('run_1')
    expect(list.body).toContain('创建订单')

    const report = serve(dataRoot, '/dashboard/api/dataforge/artifacts/run_1/report')
    expect(report.status).toBe(200)
    expect(report.type).toContain('text/html')
    expect(report.body).toContain('ok')

    const dataset = serve(dataRoot, '/dashboard/api/dataforge/artifacts/run_1/dataset')
    expect(dataset.status).toBe(200)
    expect(dataset.body).toContain('run-dataset')

    const asset = serve(dataRoot, '/dashboard/api/dataforge/artifacts/run_1/asset?name=success.png')
    expect(asset.status).toBe(200)
    expect(asset.type).toContain('image/png')
    const relative = serve(dataRoot, '/dashboard/api/dataforge/artifacts/run_1/success.png')
    expect(relative.status).toBe(200)
    expect(relative.type).toContain('image/png')
  })

  it('筛选/分页：kind + q + limit/offset', () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'df-artifacts-'))
    mkdirSync(join(dataRoot, 'datasets'), { recursive: true })
    for (const [runId, kind, site, flow] of [
      ['run_a', 'run-dataset', '站点A', '创建订单'],
      ['run_b', 'ui-run-dataset', '站点B', '查看页面'],
      ['run_c', 'run-dataset', '站点A', '清理订单'],
    ] as const) {
      writeFileSync(join(dataRoot, 'datasets', `${runId}.json`), JSON.stringify({
        kind, status: 'completed', site, flow, createdAt: '2026-10-18T00:00:00Z',
      }))
    }
    const filtered = serve(dataRoot, '/dashboard/api/dataforge/artifacts?kind=chain&q=站点A&limit=1&offset=0')
    const body = JSON.parse(filtered.body) as { data?: { artifacts: Array<{ runId: string }>; total: number } }
    expect(body.data?.total).toBe(2)
    expect(body.data?.artifacts).toHaveLength(1)
    expect(body.data?.artifacts[0]?.runId).toBe('run_a')
    const next = serve(dataRoot, '/dashboard/api/dataforge/artifacts?kind=chain&q=站点A&limit=1&offset=1')
    expect((JSON.parse(next.body) as { data?: { artifacts: Array<{ runId: string }> } }).data?.artifacts[0]?.runId).toBe('run_c')
  })

  it('非 artifacts 路径返回 false；非法证据名 400', () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'df-artifacts-'))
    const none = serve(dataRoot, '/dashboard/api/dataforge/runs')
    expect(none.handled).toBe(false)
    const bad = serve(dataRoot, '/dashboard/api/dataforge/artifacts/run_1/asset?name=../../secret')
    expect(bad.status).toBe(400)
  })
})
